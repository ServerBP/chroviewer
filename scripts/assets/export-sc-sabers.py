"""Export the supplied SC Saber bundles (requires UnityPy==1.25.4)."""

import argparse
import json
import math
import pathlib
import struct

import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler


def export(bundle, output, textures):
    environment = UnityPy.load(str(bundle))
    objects = {obj.path_id: obj for obj in environment.objects}
    data = {
        obj.path_id: obj.read_typetree()
        for obj in environment.objects
        if obj.type.name in ("GameObject", "Transform", "MeshFilter", "MeshRenderer", "Material")
    }
    transforms = {
        value["m_GameObject"]["m_PathID"]: value
        for key, value in data.items()
        if objects[key].type.name == "Transform"
    }

    def transform(vector, current, normal=False):
        # LeftSaber/RightSaber positions are editor preview offsets, not grip offsets.
        while data[current["m_GameObject"]["m_PathID"]]["m_Name"] not in ("LeftSaber", "RightSaber"):
            scale = [current["m_LocalScale"][key] for key in "xyz"]
            x, y, z = [vector[i] / scale[i] if normal else vector[i] * scale[i] for i in range(3)]
            a, b, c, w = [current["m_LocalRotation"][key] for key in "xyzw"]
            tx, ty, tz = 2 * (b * z - c * y), 2 * (c * x - a * z), 2 * (a * y - b * x)
            vector = [x + w * tx + b * tz - c * ty, y + w * ty + c * tx - a * tz, z + w * tz + a * ty - b * tx]
            if not normal:
                vector = [value + current["m_LocalPosition"][key] for value, key in zip(vector, "xyz")]
            current = data[current["m_Father"]["m_PathID"]]
        if normal:
            length = math.sqrt(sum(value * value for value in vector))
            vector = [value / length for value in vector]
        return [-vector[0], vector[1], vector[2]]

    gltf = {
        "asset": {"version": "2.0", "generator": "SC Saber UnityPy exporter"},
        "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [],
        "materials": [], "buffers": [{}], "bufferViews": [], "accessors": [],
    }
    binary = bytearray()
    materials = {}

    def accessor(values, fmt, kind, component, target):
        binary.extend(b"\0" * (-len(binary) % 4))
        offset = len(binary)
        flat = [value for row in values for value in row]
        binary.extend(struct.pack("<" + fmt * len(flat), *flat))
        view = len(gltf["bufferViews"])
        gltf["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": len(binary) - offset, "target": target})
        index = len(gltf["accessors"])
        entry = {"bufferView": view, "componentType": component, "count": len(values), "type": kind}
        if kind == "VEC3":
            entry.update(min=[min(row[i] for row in values) for i in range(3)], max=[max(row[i] for row in values) for i in range(3)])
        gltf["accessors"].append(entry)
        return index

    for obj in environment.objects:
        if obj.type.name != "MeshRenderer":
            continue
        renderer = data[obj.path_id]
        game_object = data[renderer["m_GameObject"]["m_PathID"]]
        current = transforms[renderer["m_GameObject"]["m_PathID"]]
        ancestor = current
        side = None
        while True:
            parent_object = data[ancestor["m_GameObject"]["m_PathID"]]
            if not parent_object["m_IsActive"]:
                break
            if parent_object["m_Name"] in ("LeftSaber", "RightSaber"):
                side = parent_object["m_Name"].removesuffix("Saber")
                break
            parent = ancestor["m_Father"]["m_PathID"]
            if not parent:
                break
            ancestor = data[parent]
        if side is None or not renderer["m_Enabled"]:
            continue
        mesh_filter = next(data[entry["component"]["m_PathID"]] for entry in game_object["m_Component"] if objects[entry["component"]["m_PathID"]].type.name == "MeshFilter")
        mesh = MeshHandler(objects[mesh_filter["m_Mesh"]["m_PathID"]].read())
        mesh.process()
        positions = [transform(vertex[:3], current) for vertex in mesh.m_Vertices]
        normals = [transform(normal[:3], current, True) for normal in mesh.m_Normals]
        attributes = {"POSITION": accessor(positions, "f", "VEC3", 5126, 34962), "NORMAL": accessor(normals, "f", "VEC3", 5126, 34962)}
        if mesh.m_UV0:
            attributes["TEXCOORD_0"] = accessor([(uv[0], 1 - uv[1]) for uv in mesh.m_UV0], "f", "VEC2", 5126, 34962)
        triangles = 0
        for index, faces in enumerate(mesh.get_triangles()):
            material_id = renderer["m_Materials"][index]["m_PathID"]
            if material_id not in materials:
                material = data[material_id]
                props = material["m_SavedProperties"]
                floats, colors = dict(props["m_Floats"]), dict(props["m_Colors"])
                shader = objects[material["m_Shader"]["m_PathID"]].read_typetree()["m_ParsedForm"]["m_Name"]
                role = ("custom-glow" if floats.get("_CustomColors") == 1 else "static-glow") if shader.startswith("Shader Forge/") else "surface"
                rgb = [colors["_Color"][key] for key in "rgb"]
                linear = [value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4 for value in rgb]
                materials[material_id] = len(gltf["materials"])
                gltf["materials"].append({"name": material["m_Name"] + "::" + role, "pbrMetallicRoughness": {"baseColorFactor": linear + [1], "metallicFactor": 0, "roughnessFactor": 1}, "extras": {"unityShader": shader, "unityFloats": floats, "unityColors": colors}})
            indices = accessor([(value,) for face in faces for value in reversed(face)], "I", "SCALAR", 5125, 34963)
            name = f'{side}__{game_object["m_Name"]}_{index}'
            mesh_index = len(gltf["meshes"])
            gltf["meshes"].append({"name": name, "primitives": [{"attributes": attributes, "indices": indices, "material": materials[material_id]}]})
            gltf["scenes"][0]["nodes"].append(len(gltf["nodes"]))
            gltf["nodes"].append({"name": name, "mesh": mesh_index})
            triangles += len(faces)
        print(bundle.name, side, len(positions), "vertices", triangles, "triangles", "bounds", [(min(row[i] for row in positions), max(row[i] for row in positions)) for i in range(3)])

    gltf["buffers"][0]["byteLength"] = len(binary)
    encoded = json.dumps(gltf, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary.extend(b"\0" * (-len(binary) % 4))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(struct.pack("<III", 0x46546C67, 2, 28 + len(encoded) + len(binary)) + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + struct.pack("<II", len(binary), 0x004E4942) + binary)
    textures.mkdir(parents=True, exist_ok=True)
    for obj in environment.objects:
        if obj.type.name == "Texture2D":
            texture = obj.read()
            filename = {"trails2.0 solid random": "sc-saber-trail.png", "HologramLines": "sc-saber-hologram.png"}.get(texture.m_Name)
            if filename:
                texture.image.save(textures / filename)
    # Retain trail properties and grip-relative endpoints for audit/re-export.
    trails = []
    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        value = obj.read_typetree()
        if "PointStart" not in value:
            continue
        material = data[value["TrailMaterial"]["m_PathID"]]
        trails.append({"side": data[value["m_GameObject"]["m_PathID"]]["m_Name"], "base": transform([0, 0, 0], data[value["PointStart"]["m_PathID"]]), "tip": transform([0, 0, 0], data[value["PointEnd"]["m_PathID"]]), "material": material, "multiplierColor": value["MultiplierColor"]})
    print(json.dumps(trails, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path("public/sabers"))
    args = parser.parse_args()
    for suffix, model in [("", "sc-saber"), (" CC", "sc-saber-cc")]:
        export(args.root / "source" / f"SC Saber{suffix}.saber", args.root / "models" / f"{model}.glb", args.root / "textures")
