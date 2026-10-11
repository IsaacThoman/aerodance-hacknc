"""Rebuild the original Aerodance character: blender -b -t 2 -P scripts/build-character.py"""
import bpy, math, os
from mathutils import Vector
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, color, metal=0, rough=.2):
    m = bpy.data.materials.new(name); m.diffuse_color = (*color, 1); m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    p.inputs['Coat Weight'].default_value = 1
    return m
skin = material('AquaGel', (.02, .42, .8), .7, .12)
skin.diffuse_color = (.02, .42, .8, .72)
skin_shader = skin.node_tree.nodes.get('Principled BSDF')
skin_shader.inputs['Alpha'].default_value = .72
eye = material('Ink', (.006, .025, .065), .1, .18)
white = material('Pearl', (.85, .97, 1), .35)
navy = material('HeadphoneShell', (.012, .06, .11), .5)
lime = material('Leaf', (.3, .8, .025), .1)
purple = material('Petal', (.52, .12, .9), .1)
gold = material('Gold', (1, .6, .035), .65)
parts = []
def orb(name, pos, scale, mat, bone, pear=False):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, location=pos)
    obj = bpy.context.object; obj.name = name
    if pear:
        for v in obj.data.vertices:
            factor = 1 - .32 * v.co.z
            v.co.x *= factor; v.co.y *= factor
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    for p in obj.data.polygons: p.use_smooth = True
    parts.append((obj, bone)); return obj

def tube(name, coords, radius, mat, bone):
    curve = bpy.data.curves.new(name, 'CURVE'); curve.dimensions = '3D'; curve.bevel_depth = radius; curve.bevel_resolution = 4
    s = curve.splines.new('POLY'); s.points.add(len(coords)-1)
    for p, co in zip(s.points, coords): p.co = (*co, 1)
    obj = bpy.data.objects.new(name, curve); bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj; obj.select_set(True)
    bpy.ops.object.convert(target='MESH'); obj = bpy.context.object
    obj.data.materials.append(mat)
    for p in obj.data.polygons: p.use_smooth = True
    parts.append((obj, bone)); obj.select_set(False)

# Reference proportions (center character): 129px head, 145px torso,
# 55px oval feet, within a 336px total silhouette. Hands are detached spheres.
# Rounded lathed torso with the reference's wide, nearly flat bottom.
profile = [(0,0),(.015,.43),(.045,.60),(.10,.66),(.20,.67),(.38,.65),(.62,.60),(.87,.52),(1.10,.44),(1.30,.34),(1.41,.22),(1.45,0)]
verts=[]; faces=[]; segments=64
for z,r in profile:
    for j in range(segments):
        angle=j*math.tau/segments
        verts.append((r*math.cos(angle),r*.68*math.sin(angle),z+.55))
for i in range(len(profile)-1):
    for j in range(segments):
        a=i*segments+j; b=i*segments+(j+1)%segments
        faces.append((a,b,b+segments,a+segments))
mesh=bpy.data.meshes.new('ReferenceBody'); mesh.from_pydata(verts,[],faces); mesh.update()
body=bpy.data.objects.new('Body',mesh); bpy.context.collection.objects.link(body); body.data.materials.append(skin)
for p in body.data.polygons: p.use_smooth=True
sub=body.modifiers.new('Rounded silhouette','SUBSURF'); sub.levels=2
bpy.context.view_layer.objects.active=body; body.select_set(True); bpy.ops.object.modifier_apply(modifier=sub.name); body.select_set(False)
parts.append((body,'Body'))
orb('Head', (0,0,2.715), (.645,.60,.645), skin, 'Head')
for sign, side in [(-1,'L'),(1,'R')]:
    orb('Arm.'+side, (sign*.96,0,1.08), (.33,.33,.33), skin, 'Arm.'+side)
    orb('Foot.'+side, (sign*.36,-.13,.30), (.43,.40,.275), skin, 'Foot.'+side)
    orb('Eye.'+side, (sign*.185,-.578,2.73), (.082,.033,.178), eye, 'Head')
    orb('acc_headphones_pad.'+side, (sign*.635,0,2.73), (.15,.25,.28), navy, 'Head')
    orb('acc_headphones_trim.'+side, (sign*.73,0,2.73), (.045,.18,.20), navy, 'Head')
tube('acc_headphones_band', [(math.cos(t)*.68,0,2.73+math.sin(t)*.66) for t in [i*math.pi/32 for i in range(33)]], .055, navy, 'Head')
tube('acc_sprout_stem', [(0,0,3.30),(.02,0,3.48),(.06,0,3.61)], .027, lime, 'Head')
for sign in [-1,1]:
    ob = orb('acc_sprout_leaf'+str(sign), (sign*.16,0,3.53), (.23,.07,.10), lime, 'Head'); ob.rotation_euler.y = sign*-.45
for i in range(5):
    a=i*math.tau/5
    orb('acc_flower_petal'+str(i), (.43+math.cos(a)*.15,-.40,3.20+math.sin(a)*.15), (.11,.055,.11), purple, 'Head')
orb('acc_flower_center', (.43,-.463,3.20), (.09,.05,.09), gold, 'Head')
tube('acc_halo_ring', [(math.cos(i*math.tau/64)*.42, math.sin(i*math.tau/64)*.42,3.58) for i in range(65)], .038, gold, 'Head')

bpy.ops.object.select_all(action='DESELECT')
arm_data=bpy.data.armatures.new('AeroSkeleton'); rig=bpy.data.objects.new('AeroRig',arm_data); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig; rig.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
positions={'Root':(0,0,0),'Body':(0,0,1.1),'Head':(0,0,2.1),'Arm.L':(-.70,0,1.94),'Arm.R':(.70,0,1.94),'Foot.L':(-.36,0,.30),'Foot.R':(.36,0,.30)}
for name,pos in positions.items():
    b=arm_data.edit_bones.new(name); b.head=pos; b.tail=Vector(pos)+Vector((0,0,.25))
    if name!='Root': b.parent=arm_data.edit_bones['Body' if name in ['Head','Arm.L','Arm.R'] else 'Root']
bpy.ops.object.mode_set(mode='OBJECT')
for obj,bone in parts:
    group=obj.vertex_groups.new(name=bone); group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    mod=obj.modifiers.new('Aero deformation','ARMATURE'); mod.object=rig; obj.parent=rig
for b in rig.pose.bones: b.rotation_mode='XYZ'
# Separate looping actions are packed as glTF animation clips.
for name,frames in [('Idle',72),('Walk',24),('Wave',60),('Dance',48)]:
    action=bpy.data.actions.new(name); rig.animation_data_create(); rig.animation_data.action=action
    for f in range(1,frames+2,3):
        t=(f-1)/frames*math.tau
        for b in rig.pose.bones: b.location=(0,0,0); b.rotation_euler=(0,0,0); b.scale=(1,1,1)
        body=rig.pose.bones['Body']; head=rig.pose.bones['Head']
        body.location.z=.045*math.sin(t)
        head.rotation_euler.y=.045*math.sin(t)
        if name=='Walk':
            body.location.z=.045*abs(math.sin(t)); body.rotation_euler.y=.07*math.sin(t)
            for s,side in [(-1,'L'),(1,'R')]:
                rig.pose.bones['Arm.'+side].rotation_euler.x=s*.65*math.sin(t)
                rig.pose.bones['Foot.'+side].location.y=s*.18*math.sin(t)
                rig.pose.bones['Foot.'+side].location.z=max(0,s*.12*math.cos(t))
        elif name=='Wave':
            rig.pose.bones['Arm.R'].rotation_euler.z=2.3+.3*math.sin(t*3)
            head.rotation_euler.y=-.12
        elif name=='Dance':
            body.location.x=.12*math.sin(t); body.location.z=.07*math.cos(t*2)
            body.rotation_euler.y=.17*math.sin(t); head.rotation_euler.z=.16*math.sin(t)
            for s,side in [(-1,'L'),(1,'R')]:
                rig.pose.bones['Arm.'+side].rotation_euler.z=s*(.85+.55*math.sin(t+s))
                rig.pose.bones['Foot.'+side].location.z=max(0,s*.15*math.sin(t))
        else:
            for s,side in [(-1,'L'),(1,'R')]: rig.pose.bones['Arm.'+side].rotation_euler.z=s*(.08+.06*math.sin(t))
        for b in rig.pose.bones:
            for prop in ['location','rotation_euler','scale']: b.keyframe_insert(data_path=prop,frame=f,group=b.name)
    track=rig.animation_data.nla_tracks.new(); track.name=name; track.strips.new(name,1,action)
    rig.animation_data.action=None
for track in rig.animation_data.nla_tracks: track.mute=True
bpy.context.scene.render.fps=24
bpy.context.scene.frame_set(1)
for b in rig.pose.bones: b.location=(0,0,0); b.rotation_euler=(0,0,0)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'assets/aero-character.blend'))
for track in rig.animation_data.nla_tracks: track.mute=False
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT,'../../packages/character/assets/aero-character.glb'),export_format='GLB',export_animations=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True,export_yup=True)
print('Aero character built successfully')
