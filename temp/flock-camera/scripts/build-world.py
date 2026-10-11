"""World-use Falcon LOD; same scale/silhouette, about 1–2k triangles.

blender -b -t 8 -P temp/flock-camera/scripts/build-world.py
Uses the existing low-poly Blender scene only for its presentation studio.
FLOCK_RENDER=0 skips renders. No detailed geometry is decimated or overwritten.
"""
import bpy
import json
import math
import os
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
MODELS = ROOT / 'client/public/models'
bpy.ops.wm.open_mainfile(filepath=str(ASSETS / 'flock-camera-low.blend'))
scene = bpy.context.scene
bpy.context.preferences.filepaths.save_version = 0
studio = bpy.data.collections['STUDIO | Excluded from exports']
for obj in list(bpy.data.objects):
    if obj.name not in studio.objects:
        bpy.data.objects.remove(obj, do_unlink=True)
collection = bpy.data.collections.new('WORLD LOD | Simplified physical assembly')
scene.collection.children.link(collection)
objects = []

def material(name, color, metal, rough):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metal
    shader.inputs['Roughness'].default_value = rough
    return mat

black = material('World | charcoal', (.013, .018, .023), .18, .48)
gray = material('World | graphite face', (.032, .038, .044), .05, .46)
metal = material('World | silver hardware & LED reflectors', (.43, .48, .52), .8, .32)
blue = material('World | solar silicon & coated optics', (.009, .023, .044), .25, .28)

def register(obj, name, parent=None):
    obj.name = name
    for group in list(obj.users_collection): group.objects.unlink(obj)
    collection.objects.link(obj)
    obj.parent = parent
    objects.append(obj)
    return obj

def empty(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    register(obj, name, parent)
    obj.location = loc; obj.rotation_euler = rot
    return obj

root = empty('Flock_Falcon_World')
root['detail_level'] = 'World LOD; instancing recommended for large populations'
root['pole_height_m'] = 3.6576
root['reference'] = 'Same corrected IMG_0507–IMG_0511 body proportions'
camera_root = empty('Camera | adjustable aiming pivot', (0, -.174, 3.256),
                    (math.radians(7), 0, 0), root)
panel = empty('Solar assembly | simplified dual panel', (0, 0, 3.716),
              (math.radians(16), 0, 0), root)
hood_root = empty('Camera | open-bottom hood', parent=camera_root)

def mesh(name, verts, faces, mat, parent=root, smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces); data.update()
    obj = bpy.data.objects.new(name, data)
    register(obj, name, parent); data.materials.append(mat)
    for polygon in data.polygons: polygon.use_smooth = smooth
    return obj

def box(name, loc, dims, mat=black, parent=root, radius=0):
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = register(bpy.context.object, name, parent)
    obj.data.materials.append(mat); obj.location = loc; obj.scale = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if radius:
        bevel = obj.modifiers.new('Single-segment corner radius', 'BEVEL')
        bevel.width = radius; bevel.segments = 1
        bpy.ops.object.modifier_apply(modifier=bevel.name)
    return obj

def cylinder(name, loc, radius, depth, mat=black, parent=root, axis=(0, 0, 1), sides=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius, depth=depth)
    obj = register(bpy.context.object, name, parent)
    obj.data.materials.append(mat); obj.location = loc
    obj.rotation_euler = Vector(axis).to_track_quat('Z', 'Y').to_euler()
    for polygon in obj.data.polygons: polygon.use_smooth = len(polygon.vertices) == 4
    return obj

def disk(name, x, y, z, radius, mat, parent=camera_root, sides=12):
    return mesh(name, [(x+radius*math.cos(i*math.tau/sides), y,
                       z+radius*math.sin(i*math.tau/sides)) for i in range(sides)],
                [tuple(range(sides))], mat, parent)

def bezier(points, samples=4):
    a,b,c,d = [Vector(point) for point in points]
    return [tuple((1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d)
            for t in (i/samples for i in range(samples))]

def outline(width, height):
    curves = [((0,1),(.61,1),(1,.97),(1,.77)),
              ((1,.77),(1,.26),(.94,-.40),(.87,-.68)),
              ((.87,-.68),(.84,-.88),(.46,-1),(0,-1)),
              ((0,-1),(-.46,-1),(-.84,-.88),(-.87,-.68)),
              ((-.87,-.68),(-.94,-.40),(-1,.26),(-1,.77)),
              ((-1,.77),(-1,.97),(-.61,1),(0,1))]
    return [(x*width/2,z*height/2) for curve in curves for x,z in bezier(curve)]

def loft(name, profile, layers, mat, parent=camera_root):
    n = len(profile)
    verts = [(x*s,y,z*s) for y,s in layers for x,z in profile]
    faces = [(k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j)
             for k in range(len(layers)-1) for j in range(n)]
    faces += [tuple(reversed(range(n))), tuple(range((len(layers)-1)*n,len(layers)*n))]
    obj = mesh(name, verts, faces, mat, parent, True)
    obj.data.polygons[-1].use_smooth = obj.data.polygons[-2].use_smooth = False
    return obj

# Closed 12-sided pole; hollow interiors do not contribute to its distant form.
cylinder('Pole | simplified 12-foot pole', (0,0,3.6576/2), .073025/2, 3.6576)
cylinder('Mount | top sleeve', (0,0,3.546), .0416, .24)
body = loft('Camera | rounded weatherproof shell', outline(.083,.222),
            [(.032,.91),(.016,1),(-.038,.96)], black)
loft('Camera | graphite faceplate', outline(.073,.206),
     [(-.038,1),(-.039,1)], gray)

# Retain the shallow forehead and curved side cutaway as a thin closed mesh.
paths = []
for t in (0, .16, .8, 1):
    w = .0525-.0015*t
    low = -.016 if t == 0 else (-.044 if t == 1 else -.031)
    path = [(-w+.003,low),(-w,.091)]
    path += [(-w*math.cos(i*math.pi/10),.091+.029*math.sin(i*math.pi/10)) for i in range(1,11)]
    path += [(w-.003,low)]
    paths.append(path)
n = len(paths[0]); verts = []
for inner in (False,True):
    for t,path in zip((0,.16,.8,1),paths):
        for x,z in path:
            y = -.066+.1*t-.006*(1-t)**2*max(0,(z-.091)/.029)
            verts.append((x*(.956 if inner else 1),y,
                          .091+(z-.091)*(.0266/.029) if inner and z>.091 else z))
offset = len(paths)*n; faces = []
for k in range(len(paths)-1):
    for j in range(n-1):
        a=k*n+j; b=a+n
        faces += [(a,a+1,b+1,b),(offset+a,offset+b,offset+b+1,offset+a+1)]
for j in range(n-1):
    faces.append((j,offset+j,offset+j+1,j+1))
    a=(len(paths)-1)*n+j
    faces.append((a,a+1,offset+a+1,offset+a))
for k in range(len(paths)-1):
    for j in (0,n-1):
        a=k*n+j; b=a+n; faces.append((a,b,offset+b,offset+a))
mesh('Camera | open-bottom wraparound sun hood', verts, faces, black, hood_root, True)

# Flat layered shapes preserve the optical layout without barrels/bowls/domes.
drop = []
for curve in [((0,.093),(.019,.093),(.028,.075),(.027,.061)),
              ((.027,.061),(.026,.04),(.013,.015),(0,.012)),
              ((0,.012),(-.013,.015),(-.026,.04),(-.027,.061)),
              ((-.027,.061),(-.028,.075),(-.019,.093),(0,.093))]:
    drop += [(x*.9,z*.9+.0132) for x,z in bezier(curve,3)]
mesh('Optics | flat teardrop insert', [(x,-.0396,z) for x,z in drop],
     [tuple(range(len(drop)))], black, camera_root)
disk('Optics | aperture carrier',0,-.040,.069,.0209,black,sides=16)
for i in range(6):
    a=math.pi/2+i*math.tau/6
    disk('Optics | LED reflector',.01296*math.cos(a),-.041,.069+.01296*math.sin(a),.0039,metal,sides=8)
disk('Optics | coated lens',0,-.0413,.069,.00513,blue)
disk('Optics | motion sensor',0,-.0402,.0348,.0032,blue,sides=8)
disk('Logo | roundel',0,-.0393,-.064,.013485,black)
mesh('Logo | flat tree mark', [(-.0005,-.0396,-.073),(.0005,-.0396,-.073),
     (.0005,-.0396,-.055),(-.0005,-.0396,-.055),(-.0005,-.0396,-.064),
     (-.0055,-.0396,-.058),(-.0065,-.0396,-.059),(-.0005,-.0396,-.067),
     (.0006,-.0396,-.058),(.0055,-.0396,-.054),(.0055,-.0396,-.0585)],
     [(0,1,2,3),(4,5,6,7),(8,9,10)],metal,camera_root)

# Main bracket and two smooth metal straps; no fasteners or perforations.
box('Mount | saddle',(0,-.042,3.195),(.036,.014,.085))
box('Mount | cantilever',(0,-.067,3.169),(.025,.068,.016))
box('Mount | swivel block',(0,-.097,3.195),(.042,.04,.064))
box('Mount | camera attachment',(0,.035,-.057),(.037,.019,.047),parent=camera_root)
cylinder('Mount | coupling',(0,-.125,3.22),.008,.027,axis=(0,-1,-.35),sides=8)
for z in (3.165,3.225):
    verts=[(.0377*math.cos(i*math.tau/12),.0377*math.sin(i*math.tau/12),z+dz)
           for dz in (-.0055,.0055) for i in range(12)]
    mesh('Mount | stainless band',verts,[(i,(i+1)%12,12+(i+1)%12,12+i) for i in range(12)],metal,smooth=True)

W=.7112; H=.53975
box('PV | continuous backsheet',(0,0,-.008),(W-.02,H-.02,.006),parent=panel)
for x in (-W/2+.008,W/2-.008): box('PV | side frame',(x,0,0),(.016,H,.031),parent=panel)
for y in (-H/2+.008,H/2-.008): box('PV | end frame',(0,y,0),(W-.016,.016,.031),parent=panel)
box('PV | panel divider',(0,0,.003),(.013,H-.018,.022),parent=panel)
for half in (-1,1):
    for row in range(9):
        for col in range(4):
            x=half*.1778+(col-1.5)*.0815; y=(row-4)*.0554
            mesh('PV | flat silicon cell',[(x+u,y+v,.0083) for u,v in
                 ((-.039,-.0265),(.039,-.0265),(.039,.0265),(-.039,.0265))],[(0,1,2,3)],blue,panel)
for y in (-.18,.18): box('Solar mount | rail',(0,y,-.031),(W-.068,.027,.024),parent=panel)
box('Solar mount | spine',(0,0,-.068),(.073,.091,.077),parent=panel)
# User-requested World LOD omits the under-panel battery packs and external wire.

# Material batching within component pivots keeps viewer controls meaningful.
buckets={}
for obj in objects:
    if obj.type not in ('MESH','CURVE'): continue
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
    bpy.context.view_layer.objects.active=obj; bpy.ops.object.convert(target='MESH')
    buckets.setdefault((obj.parent,tuple(obj.data.materials)),[]).append(obj)
for batch in buckets.values():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in batch: obj.select_set(True)
    bpy.context.view_layer.objects.active=batch[0]
    if len(batch)>1: bpy.ops.object.join()
objects=list(collection.objects)
for obj in objects:
    if obj.type!='MESH': continue
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
stats={'mesh_objects':0,'triangles':0,'vertices':0,'materials':4,'named_components':len(objects)}
for obj in objects:
    if obj.type!='MESH': continue
    obj.data.calc_loop_triangles()
    stats['mesh_objects']+=1; stats['triangles']+=len(obj.data.loop_triangles); stats['vertices']+=len(obj.data.vertices)
(ASSETS/'model-stats-world.json').write_text(json.dumps(stats,indent=2)+'\n')
print('WORLD MODEL STATS',stats,flush=True)
assert stats['triangles']<=2000, 'World LOD exceeded its geometry budget'
scene.camera=bpy.data.objects['View | camera and panel hero']
scene['model_notes']='World LOD; simplified silhouette model. Metres. Use instancing and spatial culling for large populations.'
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.wm.save_as_mainfile(filepath=str(ASSETS/'flock-camera-world.blend'))
for obj in objects: obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(MODELS/'flock-camera-world.glb'),export_format='GLB',
                         use_selection=True,export_apply=True,export_yup=True,export_extras=True,
                         export_animations=False,export_cameras=False,export_lights=False)
if os.environ.get('FLOCK_RENDER','1')!='0':
    for name,cam in [('assembly','View | complete pole'),('optics','View | optics close-up'),('side','View | corrected body profile')]:
        scene.camera=bpy.data.objects[cam]
        scene.render.resolution_x=1200 if name=='assembly' else 1600
        scene.render.resolution_y=1800 if name=='assembly' else 1400
        scene.render.filepath=str(ASSETS/'renders'/(name+'-world.png'))
        bpy.ops.render.render(write_still=True)
print('World LOD saved and exported.',flush=True)
