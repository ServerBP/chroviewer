"""Export active Unity saber meshes in chroviewer's Left__/Right__ convention."""
import UnityPy,json,struct,pathlib,math,argparse
from UnityPy.helpers.MeshHelper import MeshHandler
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('bundle',type=pathlib.Path)
parser.add_argument('output',type=pathlib.Path,help='Output GLB path')
parser.add_argument('--trail',type=pathlib.Path,required=True,help='Output PNG path')
args=parser.parse_args()
E=UnityPy.load(str(args.bundle)); O={o.path_id:o for o in E.objects}
def tree(i): return O[i].read_typetree()
D={o.path_id:o.read_typetree() for o in E.objects if o.type.name in ['GameObject','Transform','MeshFilter','MeshRenderer','Material']}
GO={d['m_GameObject']['m_PathID']:d for i,d in D.items() if O[i].type.name=='Transform'}
def xyz(v): return [v[k] for k in 'xyz']
def rot(v,q):
 x,y,z=v; a,b,c,w=[q[k] for k in 'xyzw']; tx,ty,tz=2*(b*z-c*y),2*(c*x-a*z),2*(a*y-b*x)
 return [x+w*tx+b*tz-c*ty,y+w*ty+c*tx-a*tz,z+w*tz+a*ty-b*tx]
def transform(v,t,normal=False):
 while True:
  s=xyz(t['m_LocalScale']); v=[v[i]/s[i] if normal else v[i]*s[i] for i in range(3)]; v=rot(v,t['m_LocalRotation'])
  if not normal: v=[a+b for a,b in zip(v,xyz(t['m_LocalPosition']))]
  parent=t['m_Father']['m_PathID']
  if parent==0: break
  t=D[parent]
 if normal:
  length=math.sqrt(sum(a*a for a in v)); v=[a/length for a in v]
 # Mirror Unity's X: matches the existing saber exporter + root.rotation.y=PI.
 return [-v[0],v[1],v[2]]
G={'asset':{'version':'2.0','generator':'SpiderSliderSticks UnityPy exporter'},'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'meshes':[],'materials':[],'buffers':[{}],'bufferViews':[],'accessors':[]}
B=bytearray(); mats={}
def acc(values,fmt,typ,component,target):
 while len(B)%4:B.append(0)
 offset=len(B); flat=[v for row in values for v in row]; B.extend(struct.pack('<'+fmt*len(flat),*flat)); vi=len(G['bufferViews']); G['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(B)-offset,'target':target})
 ai=len(G['accessors']); a={'bufferView':vi,'componentType':component,'count':len(values),'type':typ}
 if typ=='VEC3':a.update(min=[min(v[i] for v in values) for i in range(3)],max=[max(v[i] for v in values) for i in range(3)])
 G['accessors'].append(a);return ai
for o in E.objects:
 if o.type.name!='MeshRenderer':continue
 r=D[o.path_id]; gid=r['m_GameObject']['m_PathID']; go=D[gid]
 if not r['m_Enabled'] or not go['m_IsActive']:continue
 t=GO[gid]; ancestor=t; names=[]
 while True:
  names.append(D[ancestor['m_GameObject']['m_PathID']]['m_Name']); parent=ancestor['m_Father']['m_PathID']
  if not parent:break
  ancestor=D[parent]
 side='Left' if 'LeftSaber' in names else 'Right' if 'RightSaber' in names else None
 if side is None:continue
 mf=next(D[c['component']['m_PathID']] for c in go['m_Component'] if O[c['component']['m_PathID']].type.name=='MeshFilter'); mid=mf['m_Mesh']['m_PathID']
 h=MeshHandler(O[mid].read()); h.process()
 for si,tris in enumerate(h.get_triangles()):
  matid=r['m_Materials'][si]['m_PathID']; mat=D[matid]; name=mat['m_Name']; props=mat['m_SavedProperties']; floats=dict(props['m_Floats']); colors=dict(props['m_Colors']); role='custom-glow' if floats.get('_CustomColors')==1 else 'surface'
  if matid not in mats:
   mats[matid]=len(G['materials']); c=colors['_Color']; rgb=[c[k] for k in 'rgb']; linear=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
   G['materials'].append({'name':f'{name}::{role}','pbrMetallicRoughness':{'baseColorFactor':linear+[1],'metallicFactor':0,'roughnessFactor':1},'extras':{'unityShader':tree(mat['m_Shader']['m_PathID'])['m_ParsedForm']['m_Name'],'unityFloats':floats,'unityColors':colors}})
  positions=[transform(v[:3],t) for v in h.m_Vertices]; normals=[transform(v[:3],t,True) for v in h.m_Normals]
  attrs={'POSITION':acc(positions,'f','VEC3',5126,34962),'NORMAL':acc(normals,'f','VEC3',5126,34962)}
  if h.m_UV0: attrs['TEXCOORD_0']=acc([(v[0],1-v[1]) for v in h.m_UV0],'f','VEC2',5126,34962)
  indices=acc([(v,) for tri in tris for v in reversed(tri)],'I','SCALAR',5125,34963)
  mi=len(G['meshes']); G['meshes'].append({'name':f'{side}__{go["m_Name"]}','primitives':[{'attributes':attrs,'indices':indices,'material':mats[matid]}]}); ni=len(G['nodes']); G['nodes'].append({'name':f'{side}__{go["m_Name"]}','mesh':mi}); G['scenes'][0]['nodes'].append(ni)
  print(side,go['m_Name'],name,len(positions),len(tris), 'z',min(v[2] for v in positions),max(v[2] for v in positions))
G['buffers'][0]['byteLength']=len(B)
J=json.dumps(G,separators=(',',':')).encode(); J+=b' '*((-len(J))%4);B+=b'\0'*((-len(B))%4)
out=struct.pack('<III',0x46546c67,2,12+8+len(J)+8+len(B))+struct.pack('<II',len(J),0x4e4f534a)+J+struct.pack('<II',len(B),0x004e4942)+B
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_bytes(out)
args.trail.parent.mkdir(parents=True,exist_ok=True)
O[-7066348053783982107].read().image.save(args.trail)
print('GLB bytes',len(out))
