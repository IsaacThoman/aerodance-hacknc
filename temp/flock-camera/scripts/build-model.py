"""Photo-referenced older Flock Falcon. Blender 4.5+, no external assets.

blender -b -t 8 -P temp/flock-camera/scripts/build-model.py
Optional: FLOCK_RENDER=0 skips the presentation renders.
FLOCK_LOD=low produces the separate lightweight variant.
Geometry is in metres, Z up in Blender; glTF exports Y up.
"""
import bpy
import math
import os
import json
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
LOW_POLY = os.environ.get('FLOCK_LOD') == 'low'
MODEL_NAME = 'flock-camera-low' if LOW_POLY else 'flock-camera'
ASSETS = ROOT / 'assets'
MODELS = ROOT / 'client/public/models'
RENDERS = ASSETS / 'renders'
for directory in (ASSETS, MODELS, RENDERS):
    directory.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for collection in list(bpy.data.collections):
    if collection.name != 'Collection':
        bpy.data.collections.remove(collection)
base_collection = bpy.data.collections.get('Collection')
base_collection.name = 'FLOCK | Reference reconstruction'
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.unit_settings.length_unit = 'METERS'
bpy.context.preferences.filepaths.save_version = 0

def collection(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c

groups = {name: collection(name) for name in (
    '01 | Pole', '02 | Camera housing', '03 | Optics', '04 | Camera mount',
    '05 | Solar array', '06 | Solar mount', '07 | Battery enclosures',
    '08 | Wiring', '09 | Fasteners & labels', 'STUDIO | Excluded from exports')}
current = groups['01 | Pole']
asset_objects = []

def material(name, rgb, metal=0, rough=.4, coat=0, micro=False):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    p = nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*rgb, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    p.inputs['Coat Weight'].default_value = coat
    p.inputs['Coat Roughness'].default_value = .16
    if micro:
        noise = nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 1800
        noise.inputs['Detail'].default_value = 2
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .16
        bump.inputs['Distance'].default_value = .00008
        links.new(noise.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], p.inputs['Normal'])
    return m

pole_mat = material('Black powder-coated aluminum', (.014,.019,.024), .65,.30,.16,True)
shell = material('Injection molded charcoal | fine grain', (.022,.027,.032), .06,.38,.1,True)
face_mat = material('Graphite faceplate', (.032,.038,.044), .01,.46,.06,True)
hood_mat = material('Sun hood | satin black', (.009,.012,.015), .04,.43,.08,True)
rubber = material('EPDM seals & cable jackets', (.009,.011,.014),0,.56)
steel = material('Stainless hardware', (.43,.48,.52),.90,.26)
dark_steel = material('Black anodized mount', (.014,.019,.025),.45,.35)
aluminum = material('Panel edge machining', (.19,.22,.26),.92,.27)
optic_black = material('Optical cavity', (.004,.006,.009),.18,.2)
glass = material('Lens | multilayer blue coating', (.018,.049,.074),.4,.075,.85)
led_glass = material('Clear LED encapsulant', (.32,.43,.49),.48,.11,.65)
reflector = material('LED reflector bowls', (.62,.69,.74),.95,.18)
gold = material('LED die & connector contacts', (.68,.43,.11),.72,.25)
solar_mat = material('Monocrystalline silicon | blue black', (.009,.018,.037),.16,.30,.45)
solar_alt = material('Monocrystalline silicon | alternate cells', (.012,.023,.044),.16,.32,.45)
solar_back = material('PV backsheet', (.052,.058,.064),.1,.6)
trace = material('PV silver collector lines', (.25,.33,.42),.8,.33)
white = material('Polyester equipment label', (.67,.71,.73),.05,.52)
ink = material('Label printing', (.012,.014,.016),0,.6)
badge = material('Embossed flock mark', (.083,.092,.1),.35,.33)

def register(obj, name, mat=None, parent=None, smooth=False, studio=False):
    obj.name = name
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    current.objects.link(obj)
    if mat:
        obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    if smooth and obj.type == 'MESH':
        for p in obj.data.polygons:
            p.use_smooth = True
    if not studio:
        asset_objects.append(obj)
    return obj

def empty(name, location=(0,0,0), rotation=(0,0,0)):
    obj = bpy.data.objects.new(name, None)
    register(obj, name)
    obj.location = location
    obj.rotation_euler = rotation
    obj.empty_display_size = .05
    return obj

root = empty('Flock_Falcon_Assembly')
root['reference'] = 'User photo, Syracuse / Destiny USA; older elongated Falcon housing'
root['scale_note'] = 'Photographic reconstruction; estimated hidden geometry, not manufacturer CAD'
root['pole_height_m'] = 3.6576
root['pole_od_m'] = .073025

def mesh(name, vertices, faces, mat, parent=root, smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    return register(obj, name, mat, parent, smooth)

def bevel(obj, width=.001, segments=3):
    mod = obj.modifiers.new('Physical edge radii', 'BEVEL')
    mod.width = width
    mod.segments = 1 if LOW_POLY else segments
    mod.limit_method = 'ANGLE'
    mod = obj.modifiers.new('Weighted surface normals', 'WEIGHTED_NORMAL')
    mod.keep_sharp = True
    return obj

def box(name, loc, dims, mat, parent=root, edge=.001):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = register(bpy.context.object, name, mat, parent, smooth=bool(edge))
    obj.scale = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if edge:
        bevel(obj, edge, 4)
    return obj

def cyl(name, loc, radius, depth, mat, parent=root, axis=(0,0,1), vertices=64, edge=.0002):
    if LOW_POLY: vertices = min(vertices, 16)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj = register(bpy.context.object, name, mat, parent, True)
    obj.rotation_euler = Vector(axis).to_track_quat('Z','Y').to_euler()
    if edge:
        bevel(obj, edge, 3)
    return obj

def sphere(name, loc, scale, mat, parent=root):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12 if LOW_POLY else 48, ring_count=6 if LOW_POLY else 24, location=loc)
    obj = register(bpy.context.object, name, mat, parent, True)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj

def ring(name, loc, outer, inner, depth, mat, parent=root, axis=(0,0,1), n=96):
    if LOW_POLY: n = 32 if name.startswith('Pole |') else min(n, 16)
    verts = []
    for z,r in ((-depth/2,outer),(depth/2,outer),(-depth/2,inner),(depth/2,inner)):
        verts.extend((r*math.cos(j*math.tau/n),r*math.sin(j*math.tau/n),z) for j in range(n))
    faces=[]
    for j in range(n):
        k=(j+1)%n
        faces.extend(((j,k,n+k,n+j),(2*n+j,3*n+j,3*n+k,2*n+k),
                      (n+j,n+k,3*n+k,3*n+j),(j,2*n+j,2*n+k,k)))
    obj=mesh(name,verts,faces,mat,parent,True)
    obj.location=loc
    obj.rotation_euler=Vector(axis).to_track_quat('Z','Y').to_euler()
    return obj if LOW_POLY else bevel(obj,.0001,2)

def tube(name, points, radius, mat, parent=root, bezier=True):
    curve=bpy.data.curves.new(name,'CURVE')
    curve.dimensions='3D'
    curve.resolution_u=4 if LOW_POLY else 24
    curve.bevel_depth=radius
    curve.bevel_resolution=0 if LOW_POLY else 4
    curve.use_fill_caps=True
    if bezier:
        spline=curve.splines.new('BEZIER')
        spline.bezier_points.add(len(points)-1)
        for p,co in zip(spline.bezier_points,points):
            p.co=co
            p.handle_left_type=p.handle_right_type='AUTO'
    else:
        spline=curve.splines.new('POLY')
        spline.points.add(len(points)-1)
        for p,co in zip(spline.points,points): p.co=(*co,1)
    obj=bpy.data.objects.new(name,curve)
    return register(obj,name,mat,parent)

def apply_modifiers(obj):
    bpy.context.view_layer.objects.active=obj
    for mod in list(obj.modifiers): bpy.ops.object.modifier_apply(modifier=mod.name)

def hole(obj, loc, radius, depth, axis=(0,1,0), parent=None):
    # Cutter and target share parent-local coordinates; explicitly update matrices.
    cutter=cyl('temporary bore',loc,radius,depth,None,parent,axis,64,0)
    bpy.context.view_layer.update()
    mod=obj.modifiers.new('Machined opening','BOOLEAN')
    mod.operation='DIFFERENCE'
    mod.solver='EXACT'
    mod.object=cutter
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    asset_objects.remove(cutter)
    bpy.data.objects.remove(cutter,do_unlink=True)
    if obj.name.startswith(('Swivel | side cheek','Solar mount | pivot cradle')):
        # Drilling changes topology; restore flat plate shading after the cut.
        for polygon in obj.data.polygons:
            if len(polygon.vertices)>8: polygon.use_smooth=False
        normal=obj.modifiers.new('Plate normals after drilling','WEIGHTED_NORMAL')
        normal.keep_sharp=True

def bolt(name, loc, axis=(0,0,1), size=.0034, length=.015, parent=root, black=False, thread=False):
    if LOW_POLY: thread = False
    a=Vector(axis).normalized()
    p=Vector(loc)
    mat=dark_steel if black else steel
    cyl(name+' | threaded shank',p-a*length/2,size*.52,length,mat,parent,a,32,.00008)
    if thread:
        tangent=a.cross(Vector((0,0,1)) if abs(a.z)<.9 else Vector((0,1,0))).normalized()
        bitangent=a.cross(tangent)
        pitch=.0008
        turns=length/pitch
        points=[]
        for j in range(int(turns*16)+1):
            t=j/16*math.tau
            points.append(tuple(p-a*(j/16*pitch)+size*.53*(tangent*math.cos(t)+bitangent*math.sin(t))))
        tube(name+' | modeled helical screw thread',points,.00019,mat,parent,False)
    ring(name+' | washer',p-a*.001,size*1.28,size*.56,.0008,mat,parent,a,48)
    head=cyl(name+' | hex head',p+a*size*.4,size,size*.8,mat,parent,a,6,.00014)
    # A real hexagonal inset in the bolt head.
    if size>.002 and not LOW_POLY:
        cutter=cyl('temporary socket',p+a*size*.80,size*.43,size*.45,None,parent,a,6,0)
        bpy.context.view_layer.update()
        mod=head.modifiers.new('Hex socket','BOOLEAN'); mod.object=cutter
        bpy.context.view_layer.objects.active=head
        bpy.ops.object.modifier_apply(modifier=mod.name)
        asset_objects.remove(cutter); bpy.data.objects.remove(cutter,do_unlink=True)
    return head

def bezier_segment(points, samples=24):
    if LOW_POLY: samples = min(samples, 6)
    a,b,c,d=[Vector(p) for p in points]
    return [tuple((1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d)
            for t in (i/samples for i in range(samples))]

# The newer user-supplied front/profile references resolve a shallow top arch,
# nearly parallel sides and a broad, rounded lower body rather than a thin taper.
def camera_outline(width=.083, height=.222):
    segments=[((0,1),(.61,1),(1,.97),(1,.77)),
              ((1,.77),(1,.26),(.94,-.40),(.87,-.68)),
              ((.87,-.68),(.84,-.88),(.46,-1),(0,-1)),
              ((0,-1),(-.46,-1),(-.84,-.88),(-.87,-.68)),
              ((-.87,-.68),(-.94,-.40),(-1,.26),(-1,.77)),
              ((-1,.77),(-1,.97),(-.61,1),(0,1))]
    return [(x*width/2,z*height/2) for seg in segments for x,z in bezier_segment(seg)]

def loft(name, outline, layers, mat, parent):
    n=len(outline)
    vertices=[(x*s,y,z*s) for y,s in layers for x,z in outline]
    faces=[]
    for k in range(len(layers)-1):
        for j in range(n):
            a=k*n+j; b=k*n+(j+1)%n
            faces.append((a,b,b+n,a+n))
    faces.extend((tuple(reversed(range(n))),tuple(range((len(layers)-1)*n,len(layers)*n))))
    obj=mesh(name,vertices,faces,mat,parent,True)
    # Caps are planar. Interpolating their normals with the silhouette produces
    # false ripples, especially after an optical opening is cut into the face.
    obj.data.polygons[-1].use_smooth=False
    obj.data.polygons[-2].use_smooth=False
    return obj

def text(name, words, loc, size, mat, parent, rotation=(math.pi/2,0,0), extrude=0):
    data=bpy.data.curves.new(name,'FONT')
    data.body=words; data.size=size; data.align_x='CENTER'; data.align_y='CENTER'
    data.extrude=extrude; data.bevel_depth=.00002 if extrude else 0
    obj=bpy.data.objects.new(name,data)
    register(obj,name,mat,parent)
    obj.location=loc; obj.rotation_euler=rotation
    return obj

def transform_in_parent(obj, factors, pivot=(0,0,0), target=(0,0,0)):
    # Left-multiply in camera coordinates. Scaling an object's local Y would
    # flatten the circular front of a cylinder whose axis has been rotated to Y.
    affine=(Matrix.Translation(Vector(target)) @ Matrix.Diagonal((*factors,1))
            @ Matrix.Translation(-Vector(pivot)))
    obj.matrix_basis=affine @ obj.matrix_basis

# 12-foot black pole, hollow with actual wall thickness; no invented ground flange.
current=groups['01 | Pole']
ring('Pole | 2.875 inch OD, hollow aluminum',(0,0,3.6576/2),.073025/2,.027,3.6576,pole_mat)
ring('Pole top | sleeved rim',(0,0,3.647),.0368,.027,.019,pole_mat)

# CAMERA: lower than panel, independently aimed slightly down toward the roadway.
current=groups['02 | Camera housing']
camera_root=empty('Camera | adjustable aiming pivot',(0,-.174,3.256),(math.radians(7),0,0))
camera_root.parent=root
camera_root['nominal_body_height_m']=.22225
camera_root['nominal_body_width_m']=.083
camera_root['body_depth_m']=.071
camera_root['proportion_reference']='User IMG_0507 front; IMG_0508 profile; IMG_0509-0511 three-quarter'
outline=camera_outline()
body=loft('Camera | rounded weatherproof rear shell',outline,
          [(.044,.84),(.041,.91),(.033,.97),(.023,1),(-.015,1),(-.028,.98),(-.032,.96)],shell,camera_root)
face_outline=camera_outline(.0786,.222)
face=loft('Camera | softly radiused front faceplate',face_outline,
          [(-.032,.96),(-.035,.975),(-.041,.957),(-.045,.93)],face_mat,camera_root)
hole(face,(0,-.043,.069),.02133,.028,parent=camera_root)
seam=tube('Camera | perimeter gasket',[(x*.96,-.0324,z*.96) for x,z in face_outline]+[(face_outline[0][0]*.96,-.0324,face_outline[0][1]*.96)],.00055,rubber,camera_root,False)

# Solid thin-walled hood, swept in depth. Its lower edge rolls out of the front
# lip, runs across the side, then drops to the rear tip visible in IMG_0508/0509.
# The old rectangular side panels and semicircular forehead were too deep/tall.
stations=9 if LOW_POLY else 25
side_steps=4 if LOW_POLY else 32
arch_steps=16 if LOW_POLY else 72
paths=[]
for k in range(stations):
    t=k/(stations-1)
    half_width=.0525-.0015*t
    if t<.16:
        lower=-.016-.015*math.sin(t/.16*math.pi/2)
    elif t<=.8:
        lower=-.031
    else:
        lower=-.031-.013*((t-.8)/.2)**2
    path=[(-half_width+.003*(1-i/side_steps)**2,lower+(.091-lower)*i/side_steps) for i in range(side_steps+1)]
    path += [(-half_width*math.cos(i*math.pi/arch_steps),.091+.029*math.sin(i*math.pi/arch_steps)) for i in range(1,arch_steps+1)]
    path += [(half_width-.003*(i/side_steps)**2,.091-(.091-lower)*i/side_steps) for i in range(1,side_steps+1)]
    paths.append(path)
n=len(paths[0]);vertices=[]
for inner in (False,True):
    for k,path in enumerate(paths):
        t=k/(stations-1)
        for x,z in path:
            y=-.066+.100*t-.006*(1-t)**2*max(0,(z-.091)/.029)
            inner_z=.091+(z-.091)*(.0266/.029) if z>.091 else z
            vertices.append((x*(.956 if inner else 1),y,inner_z if inner else z))
faces=[];offset=stations*n
for k in range(stations-1):
    for j in range(n-1):
        a=k*n+j;b=a+n
        faces.extend(((a,a+1,b+1,b),(offset+a,offset+b,offset+b+1,offset+a+1)))
for j in range(n-1):
    faces.append((j,offset+j,offset+j+1,j+1))
    a=(stations-1)*n+j
    faces.append((a,a+1,offset+a+1,offset+a))
for k in range(stations-1):
    for j in (0,n-1):
        a=k*n+j;b=a+n
        faces.append((a,b,offset+b,offset+a))
hood=mesh('Camera | open-bottom wraparound sun hood',vertices,faces,hood_mat,camera_root,True)
if not LOW_POLY: bevel(hood,.0005,3)
for x in (-.050,.050):
    bolt('Hood retention screw',(x,.023,-.015),(math.copysign(1,x),0,0),.0017,.006,camera_root,True)

# Teardrop-shaped optical insert around the cluster and lower sensor.
current=groups['03 | Optics']
teardrop=[]
segments=[((0,.093),(.019,.093),(.028,.075),(.027,.061)),
          ((.027,.061),(.026,.04),(.013,.015),(0,.012)),
          ((0,.012),(-.013,.015),(-.026,.04),(-.027,.061)),
          ((-.027,.061),(-.028,.075),(-.019,.093),(0,.093))]
for seg in segments: teardrop += bezier_segment(seg,24)
insert=loft('Optics | teardrop inset bezel',teardrop,[(-.0455,1),(-.047,1)],dark_steel,camera_root)
hole(insert,(0,-.046,.062),.0223,.016,parent=camera_root)
hole(insert,(0,-.046,.024),.0048,.016,parent=camera_root)
cyl('Optics | recessed black carrier',(0,-.039,.062),.0231,.004,optic_black,camera_root,(0,1,0),128)
ring('Optics | polished aperture rim',(0,-.0476,.062),.0232,.0218,.0013,hood_mat,camera_root,(0,1,0),128)
ring('Optics | glass perimeter seal',(0,-.0481,.062),.0219,.0209,.0008,rubber,camera_root,(0,1,0),128)

# LED bowls are modeled as concave lathed meshes, with emitter die and domed caps.
def reflector_bowl(name,x,z):
    profile=[(.00455,-.0442),(.00415,-.0445),(.0038,-.0436),(.0024,-.041),(.0012,-.0407)]
    sides=12 if LOW_POLY else 64
    vs=[(x+r*math.cos(i*math.tau/sides),y,z+r*math.sin(i*math.tau/sides)) for r,y in profile for i in range(sides)]
    fs=[]
    for k in range(len(profile)-1):
        for i in range(sides):
            a=k*sides+i;b=k*sides+(i+1)%sides;fs.append((a,b,b+sides,a+sides))
    return mesh(name,vs,fs,reflector,camera_root,True)

for i in range(6):
    a=math.pi/2+i*math.tau/6
    x=.0144*math.cos(a);z=.062+.0144*math.sin(a)
    ring(f'LED {i+1} | black retaining ring',(x,-.0443,z),.0051,.0044,.0018,hood_mat,camera_root,(0,1,0),64)
    reflector_bowl(f'LED {i+1} | concave silver reflector',x,z)
    box(f'LED {i+1} | gold emitter substrate',(x,-.0413,z),(.0017,.00045,.0017),gold,camera_root,.00008)
    sphere(f'LED {i+1} | central clear dome',(x,-.0425,z),(.0022,.00135,.0022),led_glass,camera_root)
    ring(f'LED {i+1} | optical cover lip',(x,-.0448,z),.0043,.00395,.0003,led_glass,camera_root,(0,1,0),64)

ring('Lens | stepped black barrel',(0,-.046,.062),.0084,.0062,.006,optic_black,camera_root,(0,1,0),96)
ring('Lens | outer machined ring',(0,-.0487,.062),.0075,.006,.001,hood_mat,camera_root,(0,1,0),96)
cyl('Lens | deep internal baffle',(0,-.0455,.062),.0058,.001,optic_black,camera_root,(0,1,0),96)
sphere('Lens | convex blue coated element',(0,-.0476,.062),(.0057,.0012,.0057),glass,camera_root)
ring('Lens | inner aperture',(0,-.0471,.062),.0035,.0025,.00035,optic_black,camera_root,(0,1,0),64)
ring('Sensor | lower socket',(0,-.047,.024),.0047,.00355,.002,optic_black,camera_root,(0,1,0),64)
sphere('Sensor | smoked motion detector window',(0,-.0473,.024),(.00355,.0008,.00355),glass,camera_root)
# Small status light is beside the lower-right emitter, visible in the supplied photo.
cyl('Optics | status light',( .0202,-.045,.049),.0009,.0006,led_glass,camera_root,(0,1,0),24)

# Embossed circular tree-like Flock logo in the supplied camera variant.
current=groups['02 | Camera housing']
cyl('Camera | recessed logo roundel',(0,-.0452,-.074),.0093,.0004,hood_mat,camera_root,(0,1,0),96)
box('Logo | upright stem',(-.0002,-.0456,-.074),(.0011,.0005,.012),badge,camera_root,.00015)
tube('Logo | lower branch',[(-.0002,-.0458,-.075),(-.004,-.0458,-.070)],.00065,badge,camera_root,False)
leaf=mesh('Logo | upper leaf',[(.0003,-.0458,-.069),(.0037,-.0458,-.0658),(.0035,-.0458,-.0697),(.0003,-.0458,-.072)],[(0,1,2,3)],badge,camera_root)

# Rear battery door, screw recesses, labels and two connector ports.
rear=loft('Camera | removable rear service cover',camera_outline(.066,.181),[(.043,1),(.045,1)],shell,camera_root)
for x in (-.021,.021):
    for z in (-.075,.077):
        cyl('Rear | screw recess',(x,.0456,z),.003,.0005,optic_black,camera_root,(0,1,0),32)
        bolt('Rear | captive screw',(x,.046,z),(0,1,0),.0018,.009,camera_root,True)
for z in (-.018,.046):
    ring('Rear | connector socket',(0,.050,z),.007,.004,.011,dark_steel,camera_root,(0,1,0),64)
    cyl('Rear | waterproof connector body',(0,.058,z),.0055,.013,rubber,camera_root,(0,1,0),48)
    for k in range(5):
        ring('Rear | connector grip ridge',(0,.054+k*.0019,z),.006,.0053,.0008,rubber,camera_root,(0,1,0),48)

current=groups['09 | Fasteners & labels']
box('Camera | rear equipment label',(0,.0465,-.052),(.034,.0003,.021),white,camera_root,.001)
text('Camera | label title','FLOCK SAFETY',(0,.0469,-.048),.0031,ink,camera_root,(-math.pi/2,0,math.pi))
text('Camera | label subtitle','FALCON  /  LPR',(0,.0469,-.054),.0022,ink,camera_root,(-math.pi/2,0,math.pi))

# Preserve the detailed optics while correcting their size and placement against
# the front photograph: aperture about 57% of face width, logo about 37%.
for obj in list(camera_root.children):
    if obj in groups['03 | Optics'].objects.values():
        transform_in_parent(obj,(.9,1,.9),(0,0,.062),(0,0,.069))
    if obj.name.startswith('Logo |') or obj.name=='Camera | recessed logo roundel':
        transform_in_parent(obj,(1.45,1,1.45),(0,0,-.074),(0,0,-.064))
    if obj!=hood:
        transform_in_parent(obj,(1,.78,1),target=(0,-.0029,0))

# Camera saddle and double clamp straps. Strap perforations are actual openings.
current=groups['04 | Camera mount']
mount=empty('Camera mount | saddle & swivel',(0,0,3.195));mount.parent=root
box('Mount | pole saddle',(0,-.042,0),(.036,.014,.085),dark_steel,mount,.003)
box('Mount | cantilever rail',(0,-.067,-.026),(.025,.068,.016),dark_steel,mount,.002)
box('Mount | upper cantilever rail',(0,-.061,.025),(.026,.058,.013),dark_steel,mount,.002)
for z in (-.030,.030):
    strap=ring('Clamp | perforated stainless band',(0,0,z),.0376,.03665,.011,steel,mount,n=128)
    # Openings follow the circular band in its XY plane.
    for j in range(0 if LOW_POLY else 45):
        a=(j/45)*math.tau
        tangent=Vector((-math.sin(a),math.cos(a),0))
        radial=Vector((math.cos(a),math.sin(a),0))
        center=radial*.0371+Vector((0,0,z))
        cutter=box('temporary strap slot',center,(.0018,.003,.0072),None,mount,0)
        cutter.rotation_euler.z=a
        bpy.context.view_layer.update()
        mod=strap.modifiers.new('Band perforation','BOOLEAN');mod.object=cutter
        bpy.context.view_layer.objects.active=strap;bpy.ops.object.modifier_apply(modifier=mod.name)
        asset_objects.remove(cutter);bpy.data.objects.remove(cutter,do_unlink=True)
    box('Clamp | worm drive housing',(.021,-.031,z),(.019,.010,.014),steel,mount,.002)
    cyl('Clamp | tightening screw',(.024,-.038,z),.0028,.019,steel,mount,(1,0,0),32)
    bolt('Clamp | worm hex cap',(.035,-.038,z),(1,0,0),.003,.01,mount)
    tail=tube('Clamp | trimmed band tail',[(.018,-.034,z),(.040,-.04,z),(.047,-.034,z)],.0004,steel,mount)
    box('Clamp | narrow band end',(.039,-.041,z),(.018,.0008,.010),steel,mount,.0003)

# Two hinged side plates, a real ball joint and central locking bolt.
for x in (-.018,.018):
    plate=box('Swivel | side cheek',(x,-.087,-.001),(.006,.042,.064),dark_steel,mount,.004)
    apply_modifiers(plate)
    hole(plate,(x,-.086,.015),.0045,.018,(1,0,0),mount)
    hole(plate,(x,-.086,-.02),.0055,.018,(1,0,0),mount)
    bolt('Swivel | side pivot',(x*1.24,-.087,-.021),(math.copysign(1,x),0,0),.0036,.022,mount)
sphere('Swivel | spherical aiming joint',(0,-.107,.011),(.015,.015,.015),dark_steel,mount)
cyl('Swivel | camera coupling stem',(0,-.125,.025),.008,.027,dark_steel,mount,(0,-1,-.35),64)
box('Swivel | camera mounting shoe',(0,.053,-.057),(.037,.024,.047),dark_steel,camera_root,.003)
# Camera-depth correction also moves the attachment shoe onto the revised back.
shoe=bpy.data.objects['Swivel | camera mounting shoe']
transform_in_parent(shoe,(1,.78,1),target=(0,-.0029,0))
bolt('Swivel | large locking bolt',(.028,-.094,.012),(1,0,0),.0042,.044,mount,thread=True)
for x in (-.025,.025):
    bolt('Saddle | fixing screw',(x,-.045,-.023),(0,-1,0),.0028,.013,mount)
# Stainless spring wire keeper, as seen under the pivot in installation photos.
tube('Swivel | retaining spring clip',[(-.02,-.104,-.03),(-.023,-.11,-.032),(-.012,-.113,-.036),
      (0,-.109,-.035),(.007,-.107,-.03),(.001,-.103,-.027),(-.01,-.104,-.03)],.0007,steel,mount)

# SOLAR ARRAY: two 14 x 21 inch panels in one 28 x 21.25 inch assembly.
current=groups['05 | Solar array']
panel=empty('Solar assembly | 28 x 21.25 inch dual panel',(0,0,3.716), (math.radians(16),0,0)); panel.parent=root
panel['dimensions_m']=[.7112,.53975,.032]
panel['tilt_note']='16 degrees estimated from reference silhouette; adjustable separately from camera'
W=.7112;H=.53975
box('PV | continuous backsheet',(0,0,-.008),(W-.02,H-.02,.003),solar_back,panel,.001)
for x in (-W/2+.008,W/2-.008):
    box('PV | outer side extrusion',(x,0,0),(.016,H,.031),hood_mat,panel,.0008)
    box('PV | side bright edge',(x+math.copysign(.007,x),0,.014),(.001,H,.001),aluminum,panel,.00015)
    box('PV | side extrusion groove',(x+math.copysign(.0081,x),0,-.004),(.0003,H-.02,.0014),optic_black,panel,.0001)
for y in (-H/2+.008,H/2-.008):
    box('PV | end extrusion',(0,y,0),(W-.016,.016,.031),hood_mat,panel,.0008)
    box('PV | end bright edge',(0,y+math.copysign(.007,y),.014),(W,.001,.001),aluminum,panel,.0001)
box('PV | two-panel center divider',(0,0,.003),(.013,H-.018,.022),hood_mat,panel,.0005)
# Glass is a thin tinted surface below the individually modeled cells' edge lines.
box('PV | laminated glass substrate',(0,0,.006),(W-.029,H-.029,.004),solar_mat,panel,.001)
trace_vertices=[];trace_faces=[]
def trace_rect(x,y,z,w,h):
    i=len(trace_vertices)
    trace_vertices.extend(((x-w/2,y-h/2,z),(x+w/2,y-h/2,z),(x+w/2,y+h/2,z),(x-w/2,y+h/2,z)))
    trace_faces.append((i,i+1,i+2,i+3))

cell_w=.078;cell_h=.053
for half in (-1,1):
    for row in range(9):
        for col in range(4):
            x=half*.1778+(col-1.5)*.0815
            y=(row-4)*.0554
            clip=.005
            coords=[(-cell_w/2+clip,-cell_h/2),(cell_w/2-clip,-cell_h/2),
                    (cell_w/2,-cell_h/2+clip),(cell_w/2,cell_h/2-clip),
                    (cell_w/2-clip,cell_h/2),(-cell_w/2+clip,cell_h/2),
                    (-cell_w/2,cell_h/2-clip),(-cell_w/2,-cell_h/2+clip)]
            mesh(f'PV cell | {"L" if half<0 else "R"}-{row+1:02}-{col+1}',
                 [(x+u,y+v,.0083) for u,v in coords],[tuple(range(8))],
                 solar_alt if (row+col)%4==0 else solar_mat,panel)
            for k in range(15): trace_rect(x,y+(k-7)*.0033,.00836,cell_w-.006,.000085)
            for k in (-1,0,1): trace_rect(x+k*.022,y,.00838,.00038,cell_h+.0024)
mesh('PV | 1296 modeled collector fingers & busbars',trace_vertices,trace_faces,trace,panel)
for x in (-.340,.340):
    for y in (-.254,.254):
        bolt('PV frame | corner fastener',(x,y,-.019),(0,0,-1),.0023,.012,panel)

# Under-panel support rails, pivot cradle, long top sleeve and set screws.
current=groups['06 | Solar mount']
for y in (-.180,.180):
    box('Solar mount | transverse channel',(0,y,-.031),(W-.068,.027,.024),dark_steel,panel,.001)
    box('Solar mount | channel flange',(0,y-.014,-.046),(W-.068,.005,.004),dark_steel,panel,.0003)
    for x in (-.285,-.20,-.061,.061,.20,.285):
        bolt('Solar rail | anchor bolt',(x,y,-.046),(0,0,-1),.0034,.018,panel)
box('Solar mount | longitudinal spine',(0,0,-.045),(.073,H-.045,.03),dark_steel,panel,.002)
for x in (-.029,.029):
    bracket=box('Solar mount | pivot cradle',(x,0,-.087),(.007,.091,.095),dark_steel,panel,.004)
    apply_modifiers(bracket)
    hole(bracket,(x,0,-.083),.005,.018,(1,0,0),panel)
    for y in (-.03,.03):
        bolt('Solar cradle | angle lock',(x*1.3,y,-.089),(math.copysign(1,x),0,0),.0042,.025,panel)
    bolt('Solar cradle | central pivot',(x*1.33,0,-.08),(math.copysign(1,x),0,0),.0048,.08,panel)
ring('Solar mount | pole-top sleeve',(0,0,3.546),.0416,.0372,.24,dark_steel)
ring('Solar mount | sleeve lower lip',(0,0,3.432),.0426,.0372,.01,hood_mat)
for z in (3.455,3.535,3.613):
    for x in (-1,1):
        bolt('Pole sleeve | opposing set screw',(x*.048,0,z),(x,0,0),.0045,.020,root,thread=True)

# Black gasketed external packs suspended under the panel, not embedded in it.
current=groups['07 | Battery enclosures']
packs=[]
for i,x in enumerate((-.181,.181)):
    pack=empty(f'Battery pack {i+1} | under-panel enclosure',(x,.017,-.102));pack.parent=panel
    packs.append(pack)
    box(f'Battery {i+1} | rounded weatherproof box',(0,0,-.014),(.145,.207,.128),shell,pack,.012)
    box(f'Battery {i+1} | lid',(0,0,-.081),(.148,.210,.014),hood_mat,pack,.008)
    box(f'Battery {i+1} | lid gasket',(0,0,-.074),(.145,.207,.0018),rubber,pack,.006)
    for xx in (-.061,.061):
        box('Battery | mounting ear',(xx,0,.053),(.028,.247,.007),dark_steel,pack,.003)
        for yy in (-.112,.112):
            bolt('Battery | mounting ear screw',(xx,yy,.05),(0,0,-1),.0029,.018,pack)
    for xx in (-.058,.058):
        for yy in (-.088,.088):
            bolt('Battery | captive lid screw',(xx,yy,-.09),(0,0,-1),.0025,.013,pack)
    for yy in (-.042,.017,.073):
        cyl('Battery | connector gland',(.077,yy,-.015),.0067,.013,dark_steel,pack,(1,0,0),48)
        for j in range(4):
            ring('Battery | gland ribs',(.08+j*.0019,yy,-.015),.0069,.005,.0007,rubber,pack,(1,0,0),48)
    box('Battery | side inventory label',(-.0734,.02,-.012),(.0005,.079,.032),white,pack,.001)
    text('Battery | label text','FLOCK\nPOWER MODULE',(-.074,.02,-.013),.0036,ink,pack,(math.pi/2,0,-math.pi/2))

# Junction box on underside and a pair of strain-relieved panel leads.
box('PV | sealed junction box',(0,.159,-.034),(.046,.066,.027),rubber,panel,.004)
for x in (-.013,.013):
    cyl('PV | junction cable gland',(x,.12,-.041),.0032,.017,rubber,panel,(0,-1,0),32)

current=groups['08 | Wiring']
bpy.context.view_layer.update()
def world(obj,p): return tuple(obj.matrix_world @ Vector(p))
for i,pack in enumerate(packs):
    start=world(pack,(.09,-.042,-.015))
    end=world(panel,((-.013 if i==0 else .013),.115,-.041))
    tube(f'Cable | panel to battery {i+1}',[start,(start[0]+.023,start[1]-.04,start[2]-.025),
         ((start[0]+end[0])/2,end[1]-.09,end[2]-.08),end],.0023,rubber)
start=world(packs[1],(.09,.017,-.015));end=world(packs[0],(.09,.017,-.015))
tube('Cable | battery cross-link service loop',[start,(.26,.04,3.46),(.06,.079,3.45),(-.07,.062,3.47),end],.0025,rubber)
start=world(packs[0],(.09,.073,-.015))
end=world(camera_root,(0,.0464,.046))
tube('Cable | power harness to camera',[start,(-.07,.01,3.50),(-.040,-.016,3.44),
     (-.042,-.031,3.31),(-.035,-.045,3.235),(.01,-.099,3.239),end],.0027,rubber)
end2=world(camera_root,(0,.0464,-.018))
start2=world(packs[1],(.09,.073,-.015))
tube('Cable | lower camera service lead',[start2,(.125,.039,3.48),(.044,.039,3.411),(.040,-.007,3.29),
     (.05,-.076,3.202),(.025,-.101,3.191),end2],.0023,rubber)
for z in (3.33,3.427):
    ring('Harness | black cable tie',(0,0,z),.040,.0385,.0032,rubber)
    box('Harness | cable tie ratchet',(-.038,-.013,z),(.006,.006,.006),rubber,root,.0005)
    box('Harness | trimmed tie tail',(-.041,-.017,z-.004),(.003,.009,.001),rubber,root,.0003)

# Barcode stickers are geometry and fictional identifiers, not copied live serials.
current=groups['09 | Fasteners & labels']
for i,pack in enumerate(packs):
    for j in range(32):
        yy=-.010+j*.0017
        box('Inventory | barcode line',(-.074,yy,-.011),(.00013,.0005 if j%3 else .0009,.014),ink,pack,0)
box('Mount | inspection sticker',(.015,-.043,3.168),(.025,.0004,.006),white,root,.0003)
for j in range(17):
    box('Mount | barcode line',(.005+j*.0011,-.0433,3.168),(.0004,.0001,.004),ink,root,0)

if LOW_POLY:
    # Remove sub-pixel hardware instead of spending the polygon budget on it.
    micro_details = (' | threaded shank', ' | washer', 'grip ridge', 'gland ribs',
                     'barcode line', 'modeled collector fingers', 'gold emitter substrate',
                     'optical cover lip', 'extrusion groove', 'bright edge', 'screw recess')
    for obj in list(asset_objects):
        if obj.type == 'FONT' or any(part in obj.name for part in micro_details):
            asset_objects.remove(obj)
            bpy.data.objects.remove(obj, do_unlink=True)
    # Bake simple edge radii and cable curves, then batch compatible parts while
    # retaining camera/solar/battery pivots and a separately hideable hood.
    buckets = {}
    for obj in asset_objects:
        if obj.type not in ('MESH', 'CURVE'): continue
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True); bpy.context.view_layer.objects.active = obj
        bpy.ops.object.convert(target='MESH')
        key = (obj.parent, obj.users_collection[0], tuple(obj.data.materials), obj == hood)
        buckets.setdefault(key, []).append(obj)
    for objects in buckets.values():
        if len(objects) < 2: continue
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects: obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
    asset_objects = [obj for c in groups.values() if not c.name.startswith('STUDIO') for obj in c.objects]
    root['detail_level'] = 'Low poly; simplified hardware and cable tessellation'

# Normalize mesh winding from generated surfaces; keep high-detail bevels editable.
for obj in asset_objects:
    if obj.type=='MESH':
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')

# Export only the physical assembly. Curves/text converted in temporary copies.
bpy.ops.object.select_all(action='DESELECT')
for obj in asset_objects: obj.select_set(True)
scene['model_notes']='Older Falcon visual reconstruction. Named components; metres. See README for provenance and estimated dimensions.'

# High detail statistics from the evaluated export meshes, including curves/text.
stats={'mesh_objects':0,'triangles':0,'vertices':0,'named_components':len(asset_objects)}
deps=bpy.context.evaluated_depsgraph_get()
for obj in asset_objects:
    if obj.type in ('MESH','CURVE','FONT'):
        evaluated=obj.evaluated_get(deps)
        data=evaluated.to_mesh()
        data.calc_loop_triangles()
        stats['mesh_objects']+=1;stats['triangles']+=len(data.loop_triangles);stats['vertices']+=len(data.vertices)
        evaluated.to_mesh_clear()
(ASSETS/('model-stats-low.json' if LOW_POLY else 'model-stats.json')).write_text(json.dumps(stats,indent=2)+'\n')
print('MODEL STATS',stats,flush=True)

# Presentation studio, excluded from the GLB; useful lighting and saved viewpoints.
current=groups['STUDIO | Excluded from exports']
floor_mat=material('Studio | pale stone',(.39,.44,.49),.08,.72)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.006))
floor=register(bpy.context.object,'Studio floor',floor_mat,studio=True)
world_mat=bpy.data.worlds.new('Soft blue-gray studio')
scene.world=world_mat;world_mat.use_nodes=True
world_mat.node_tree.nodes['Background'].inputs[0].default_value=(.32,.40,.50,1)
world_mat.node_tree.nodes['Background'].inputs[1].default_value=.40

def area(name,loc,energy,size,color,target):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size;data.color=color
    obj=bpy.data.objects.new(name,data);register(obj,name,studio=True)
    obj.location=loc;obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    return obj

area('Studio | large warm key',(1.3,-2.5,4.6),95,2.4,(1,.88,.74),(0,0,3.35))
area('Studio | cool fill',(-1.5,-.8,3.4),42,1.7,(.69,.84,1),(0,0,3.35))
area('Studio | edge strip',(.6,1.6,4.4),120,1.6,(.84,.91,1),(0,0,3.5))
area('Studio | overhead',(-.3,.1,5.7),50,2,(1,1,1),(0,0,3.4))

def view(name,loc,target,ortho=None,lens=70):
    data=bpy.data.cameras.new(name);obj=bpy.data.objects.new(name,data)
    register(obj,name,studio=True);obj.location=loc
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    data.clip_start=.002;data.clip_end=300
    if ortho: data.type='ORTHO';data.ortho_scale=ortho
    else: data.lens=lens
    return obj

views={
 'assembly':view('View | complete pole',(.98,-1.7,2.3),(0,0,1.96),4.32),
 'detail':view('View | camera and panel hero',(-.87,-1.35,3.61),(0,-.045,3.455),1.05),
 'optics':view('View | optics close-up',(.28,-.68,3.36),(0,-.175,3.266),.35),
 'rear':view('View | mounting and battery hardware',(-.82,.85,3.32),(0,0,3.47),.84),
 'solar':view('View | photovoltaic surface',(.50,-.74,4.49),(0,0,3.66),.90),
 'reference':view('View | low angle matching reference',(-.85,-1.5,3.10),(0,-.045,3.465),1.04),
 'front':view('View | corrected body front',world(camera_root,(0,-.85,0)),world(camera_root,(0,0,0)),.32),
 'side':view('View | corrected body profile',world(camera_root,(.85,0,0)),world(camera_root,(0,0,0)),.32),
}
scene.camera=views['detail']
scene.render.engine='CYCLES'
scene.cycles.samples=48
scene.cycles.use_denoising=True
scene.cycles.max_bounces=6
scene.render.image_settings.file_format='PNG'
scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.render.film_transparent=False
# GPU when available, deterministic CPU fallback.
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='METAL';prefs.get_devices()
    for device in prefs.devices: device.use=device.type!='CPU'
    if any(d.use for d in prefs.devices): scene.cycles.device='GPU'
except Exception:
    pass

for screen in bpy.data.screens:
    for ar in screen.areas:
        if ar.type=='VIEW_3D':
            ar.spaces.active.clip_start=.001
            ar.spaces.active.clip_end=100
            ar.spaces.active.region_3d.view_distance=1.0
            ar.spaces.active.region_3d.view_location=(0,0,3.45)
            ar.spaces.active.region_3d.view_rotation=views['detail'].rotation_euler.to_quaternion()
            ar.spaces.active.shading.type='MATERIAL'

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True);bpy.context.view_layer.objects.active=body
scene.render.resolution_x=1600;scene.render.resolution_y=1600
bpy.ops.wm.save_as_mainfile(filepath=str(ASSETS/(MODEL_NAME+'.blend')))
# glTF only carries meshes. Save the editable source first, then convert its cable
# curves and lettering so the portable export also includes every small detail.
bpy.ops.object.select_all(action='DESELECT')
for obj in asset_objects:
    if obj.type in ('CURVE','FONT'):
        obj.select_set(True)
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.convert(target='MESH')
        obj.select_set(False)
for obj in asset_objects: obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(MODELS/(MODEL_NAME+'.glb')),export_format='GLB',
    use_selection=True,export_apply=True,export_yup=True,export_extras=True,
    export_animations=False,export_cameras=False,export_lights=False)
if os.environ.get('FLOCK_RENDER','1')!='0':
    for name,cam in views.items():
        if LOW_POLY and name not in ('assembly','optics','side'): continue
        scene.camera=cam
        scene.render.resolution_x=1200 if name=='assembly' else 1600
        scene.render.resolution_y=1800 if name=='assembly' else 1400
        scene.render.filepath=str(RENDERS/(name+('-low' if LOW_POLY else '')+'.png'))
        bpy.ops.render.render(write_still=True)
scene.camera=views['detail']
print('Flock Falcon assembly built, exported and saved.',flush=True)
