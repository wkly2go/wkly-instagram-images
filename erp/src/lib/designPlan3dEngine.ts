// 3D 보기 엔진 (브라우저 전용 · 2026-11-17 대표 지시 '평면과 3D 작업공간을 더욱 현실에 맞게')
// 그리기 · 빛과 그림자 · 카메라(조감 · 위에서 · 눈높이) · 3D 파일 저장과 열기.
// 필요할 때만 그린다: 평면이 바뀌거나, 화면을 움직이거나, 보기를 바꾸는 짧은 동안에만.
// 파일은 이 기기 안에서만 읽고 쓴다 (어디에도 올리지 않는다).
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { PlanGeometry } from './designPlan.ts'
import { PlanScene, type Look3D } from './designPlan3dScene.ts'
import { TextureBank } from './designPlan3dTex.ts'

export type ViewMode = 'orbit' | 'top' | 'eye'
/** cut = 조감에서 보는 쪽을 가리는 벽을 낮춘다 */
export interface ViewFlags { person: boolean; shadow: boolean; ceiling: boolean; cut: boolean }
/** 열어 본 3D 모델: 이름과 크기 [가로, 높이, 세로] m. shrunk = mm 로 저장된 것으로 보고 1/1000 로 줄임 */
export interface ModelInfo { name: string; size: [number, number, number]; shrunk: boolean }
interface Pose { pos: THREE.Vector3; target: THREE.Vector3; fov: number }

const FOV = 40, EYE_FOV = 64, EYE_H = 1.6
/** 해가 떠 있는 쪽: 조감에서 보는 쪽(오른쪽 앞 위) — 안쪽 벽면이 밝게 보이고 그림자는 짧게 */
const SUN = new THREE.Vector3(0.45, 1.6, 0.68).normalize()
const rad = THREE.MathUtils.degToRad

export class PlanEngine {
  private host: HTMLElement
  private renderer: THREE.WebGLRenderer
  private canvas: HTMLCanvasElement
  private scene = new THREE.Scene()
  private persp = new THREE.PerspectiveCamera(FOV, 1, 0.05, 600)
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 600)
  private cam: THREE.Camera
  private controls: OrbitControls
  private bank: TextureBank
  private plan3: PlanScene
  private env: THREE.WebGLRenderTarget
  private hemi = new THREE.HemisphereLight('#ffffff', '#d6d0c4', 1.0)
  private sun = new THREE.DirectionalLight('#fff1dc', 1.9)
  /** 바닥에서 되비치는 빛 흉내: 눈높이에서 천장 · 가구 밑면을 밝힌다 (그림자 없음) */
  private bounce = new THREE.DirectionalLight('#fff6ea', 0)
  private ground: THREE.Mesh
  private catcher: THREE.Mesh
  private fade: THREE.CanvasTexture
  private model: THREE.Group | null = null
  private modelBox = new THREE.Box3()
  private mode: ViewMode = 'orbit'
  private flags: ViewFlags = { person: true, shadow: true, ceiling: true, cut: true }
  private w = 0
  private h = 0
  private raf = 0
  private last = 0
  private needsRender = false
  private dirty = false
  private disposed = false
  private lost = false
  private pending: { plan: PlanGeometry; look: Look3D; selected: string | null } | null = null
  private framed = false
  private userMoved = false
  private fitBox = new THREE.Box3()
  private topHalf = 5
  private tween: { t0: number; ms: number; from: Pose; to: Pose; done: () => void } | null = null
  private aim = new THREE.Vector3()
  private savedOrbit: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null
  private eye = { x: 0, z: 0, yaw: 0, pitch: -0.05, tx: 0, tz: 0, set: false }
  private drag: { id: number; x: number; y: number; moved: number } | null = null
  private lastTap: { at: number; x: number; y: number } | null = null
  private ro: ResizeObserver
  private reduced = false
  private on: { empty: (empty: boolean) => void; lost: (lost: boolean) => void }

  /** 그래픽 가속이 없으면 여기서 오류가 난다 — 부르는 쪽에서 안내 글로 바꾼다 */
  constructor(host: HTMLElement, o: { pink?: string; /** 땅 색 */ ground?: string; onEmpty?: (empty: boolean) => void; onLost?: (lost: boolean) => void } = {}) {
    this.host = host
    this.on = { empty: o.onEmpty ?? (() => {}), lost: o.onLost ?? (() => {}) }
    // 먼저 그래픽 장치를 쓸 수 있는지 직접 확인한다 (없으면 조용히 안내 글로 넘어가게)
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, depth: true, stencil: false, premultipliedAlpha: true })
    if (!gl) throw new Error('이 기기에서는 3D 를 그릴 수 없습니다')
    const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.shadowMap.autoUpdate = false
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.92
    this.renderer = renderer
    this.canvas = renderer.domElement
    this.canvas.style.touchAction = 'none'
    this.canvas.style.cursor = 'grab'
    host.appendChild(this.canvas)
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

    // 빛: 반사에 쓰는 둘레 빛(밝은 방) + 하늘빛 + 그림자를 만드는 해 하나
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment()
    this.env = pmrem.fromScene(room, 0.04)
    room.dispose()
    pmrem.dispose()
    this.scene.environment = this.env.texture
    this.scene.environmentIntensity = 0.6
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0003
    this.sun.shadow.normalBias = 0.02
    this.scene.add(this.hemi, this.sun, this.sun.target, this.bounce, this.bounce.target)

    // 땅: 가장자리로 갈수록 옅어지는 밝은 원판, 그 위에 그림자만 받는 판
    const fc = document.createElement('canvas')
    fc.width = fc.height = 128
    const fx = fc.getContext('2d')
    if (fx) { const g = fx.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, '#fff'); g.addColorStop(0.5, '#fff'); g.addColorStop(1, '#000'); fx.fillStyle = g; fx.fillRect(0, 0, 128, 128) }
    this.fade = new THREE.CanvasTexture(fc)
    const disc = new THREE.CircleGeometry(1, 64)
    this.ground = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ color: o.ground || '#efece5', alphaMap: this.fade, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 }))
    this.catcher = new THREE.Mesh(disc, new THREE.ShadowMaterial({ opacity: 0.15, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 }))
    for (const [m, y, order] of [[this.ground, -0.008, -2], [this.catcher, -0.004, -1]] as const) { m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = order; this.scene.add(m) }
    this.catcher.receiveShadow = true

    this.bank = new TextureBank(Math.min(8, renderer.capabilities.getMaxAnisotropy()))
    this.plan3 = new PlanScene({ tex: s => this.bank.get(s), pink: o.pink })
    this.scene.add(this.plan3.root)

    this.cam = this.persp
    this.controls = new OrbitControls(this.persp, this.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.14
    this.controls.screenSpacePanning = false
    this.controls.zoomToCursor = true
    this.controls.addEventListener('change', this.invalidate)
    this.controls.addEventListener('start', this.onControlStart)

    this.canvas.addEventListener('pointerdown', this.onDown)
    this.canvas.addEventListener('pointermove', this.onMove)
    this.canvas.addEventListener('pointerup', this.onUp)
    this.canvas.addEventListener('pointercancel', this.onUp)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.canvas.addEventListener('webglcontextlost', this.onLost)
    this.canvas.addEventListener('webglcontextrestored', this.onRestored)
    this.ro = new ResizeObserver(this.resize)
    this.ro.observe(host)
    this.fitLights()
    this.setPersp(this.orbitPose())
    this.enterOrbit(this.orbitPose())
    this.resize()
  }

  // ── 바깥에서 부르는 것 ────────────────────────────────────────────────

  setPlan(plan: PlanGeometry, look: Look3D, selected: string | null) {
    this.pending = { plan, look, selected }
    this.dirty = true
    this.schedule()
  }

  setFlags(f: ViewFlags) {
    this.flags = { ...f }
    this.applyFlags()
    this.invalidate()
  }

  setMode(next: ViewMode) {
    if (next === this.mode) return
    const from = this.currentPose()
    if (this.mode === 'orbit' && !this.tween) this.savedOrbit = { pos: this.persp.position.clone(), target: this.controls.target.clone() }
    this.tween = null
    this.mode = next
    this.controls.enabled = false
    this.cam = this.persp
    this.setPersp(from)
    this.canvas.style.cursor = next === 'top' ? 'move' : 'grab'
    if (next === 'eye' && (!this.eye.set || !this.nearScene(this.eye.x, this.eye.z))) this.resetEye()
    const to = next === 'orbit' ? (this.savedOrbit && this.userMoved ? { ...this.savedOrbit, fov: FOV } : this.orbitPose()) : next === 'top' ? this.topPose() : this.eyePose()
    const done = () => {
      if (next === 'orbit') this.enterOrbit(to); else if (next === 'top') this.enterTop(); else this.applyEye()
      this.applyFlags()
      this.invalidate()
    }
    if (this.reduced) { this.setPersp(to); done() } else this.startTween(from, to, 560, done)
    this.applyFlags()
    this.invalidate()
  }

  /** 지금 보기에서 전체가 보이게 맞춘다 */
  fit(animate = true) {
    this.fitBox.copy(this.sceneBox())
    this.userMoved = false
    this.savedOrbit = null
    if (this.mode === 'eye') { this.tween = null; this.resetEye(); this.applyEye(); this.invalidate(); return }
    if (this.mode === 'top') { this.tween = null; this.enterTop(); this.invalidate(); return }
    const to = this.orbitPose()
    if (animate && !this.reduced && this.framed) { this.controls.enabled = false; this.startTween(this.currentPose(), to, 420, () => this.enterOrbit(to)) }
    else { this.tween = null; this.setPersp(to); this.enterOrbit(to) }
    this.invalidate()
  }

  /** 눈높이: 앞(+) · 뒤(-)로 m 만큼 걷는다 */
  walkBy(step: number) {
    if (this.mode !== 'eye' || this.tween) return
    const e = this.eye
    const [x, z] = this.clip(e.x, e.z, e.tx - Math.sin(e.yaw) * step, e.tz - Math.cos(e.yaw) * step)
    e.tx = x; e.tz = z
    this.schedule()
  }

  /** 눈높이: 왼쪽(+) · 오른쪽(-)으로 고개를 돌린다 */
  turnBy(angle: number) {
    if (this.mode !== 'eye' || this.tween) return
    this.eye.yaw += angle
    this.applyEye()
    this.invalidate()
  }

  /** 평면 모델(바닥 · 벽 · 문 · 창 · 가구)을 .glb 로. 천장 · 사람 · 열어 본 모델은 넣지 않는다 */
  async exportGlb(name: string): Promise<Blob> {
    if (this.dirty) this.applyPlan()
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
    const root = this.plan3.exportRoot(name)
    root.updateMatrixWorld(true)
    const out = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true })
    return new Blob([out as ArrayBuffer], { type: 'model/gltf-binary' })
  }

  /** 이 기기의 3D 파일(.glb, 또는 .gltf 와 함께 저장된 파일들)을 평면 옆에 놓는다 */
  async loadModel(files: File[]): Promise<ModelInfo> {
    const main = files.find(f => /\.(glb|gltf)$/i.test(f.name))
    if (!main) throw new Error('3D 파일(.glb 또는 .gltf)을 골라 주세요.')
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const urls = new Map<string, string>()
    for (const f of files) urls.set(f.name.toLowerCase(), URL.createObjectURL(f))
    const known = new Set(urls.values())
    const manager = new THREE.LoadingManager()
    // 함께 고른 파일(.bin · 그림)은 이름으로 찾아 준다
    manager.setURLModifier(u => {
      if (known.has(u) || u.startsWith('data:')) return u
      let base = u.split(/[\\/]/).pop()?.split(/[?#]/)[0] ?? ''
      try { base = decodeURIComponent(base) } catch { /* 이름 그대로 */ }
      return urls.get(base.toLowerCase()) ?? u
    })
    const loader = new GLTFLoader(manager)
    try { loader.setMeshoptDecoder((await import('three/examples/jsm/libs/meshopt_decoder.module.js')).MeshoptDecoder) } catch { /* 압축 풀기 없이 계속 */ }
    let obj: THREE.Object3D
    try {
      obj = (await loader.loadAsync(urls.get(main.name.toLowerCase())!)).scene
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/draco/i.test(msg)) throw new Error('압축(Draco)된 파일은 열 수 없습니다. 압축 없이 다시 저장해 주세요.')
      if (/\.gltf$/i.test(main.name)) throw new Error('이 파일은 함께 저장된 파일(.bin · 그림)이 있어야 열립니다. 같이 골라 주시거나 .glb 한 파일로 저장해 주세요.')
      throw new Error('3D 파일을 읽지 못했습니다. .glb 로 다시 저장해 주세요.')
    } finally {
      for (const u of known) URL.revokeObjectURL(u)
    }
    if (this.disposed) { disposeTree(obj); throw new Error('화면이 닫혔습니다.') }
    obj.updateMatrixWorld(true)
    let box = new THREE.Box3().setFromObject(obj)
    if (box.isEmpty()) { disposeTree(obj); throw new Error('이 파일에는 보여 줄 모양이 없습니다.') }
    // 가장 긴 쪽이 300m 를 넘으면 mm 로 저장된 모델로 보고 줄인다
    const raw = box.getSize(new THREE.Vector3()), shrunk = Math.max(raw.x, raw.y, raw.z) > 300
    this.clearModel()
    const holder = new THREE.Group()
    holder.name = main.name
    holder.add(obj)
    if (shrunk) holder.scale.setScalar(0.001)
    holder.updateMatrixWorld(true)
    box = new THREE.Box3().setFromObject(holder)
    // 평면 오른쪽 옆, 바닥에 닿게
    const pb = this.plan3.bounds, size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3())
    const px = pb.isEmpty() ? 0 : pb.max.x + 1 + size.x / 2, pz = pb.isEmpty() ? 0 : (pb.min.z + pb.max.z) / 2
    holder.position.set(px - c.x, -box.min.y, pz - c.z)
    holder.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
    holder.updateMatrixWorld(true)
    this.model = holder
    this.modelBox.setFromObject(holder)
    this.scene.add(holder)
    this.afterModel()
    return { name: main.name, size: [size.x, size.y, size.z], shrunk }
  }

  /** 지금 쥐고 있는 그래픽 자원 수 (새는 곳이 없는지 확인할 때) */
  stats() {
    const m = this.renderer.info.memory, r = this.renderer.info.render
    return { geometries: m.geometries, textures: m.textures, calls: r.calls, triangles: r.triangles, mode: this.mode }
  }

  clearModel() {
    if (!this.model) return
    this.scene.remove(this.model)
    disposeTree(this.model)
    this.model = null
    this.modelBox.makeEmpty()
    this.afterModel()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    for (const [type, fn] of [['pointerdown', this.onDown], ['pointermove', this.onMove], ['pointerup', this.onUp], ['pointercancel', this.onUp], ['wheel', this.onWheel], ['webglcontextlost', this.onLost], ['webglcontextrestored', this.onRestored]] as const) this.canvas.removeEventListener(type, fn as EventListener)
    this.controls.removeEventListener('change', this.invalidate)
    this.controls.removeEventListener('start', this.onControlStart)
    this.controls.dispose()
    if (this.model) { this.scene.remove(this.model); disposeTree(this.model); this.model = null }
    this.plan3.dispose()
    this.bank.dispose()
    this.env.dispose()
    this.fade.dispose()
    this.ground.geometry.dispose()
    ;(this.ground.material as THREE.Material).dispose()
    ;(this.catcher.material as THREE.Material).dispose()
    this.sun.shadow.map?.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.canvas.remove()
  }

  // ── 그리기 ──────────────────────────────────────────────────────────

  private schedule() { if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.frame) }
  private invalidate = () => { this.needsRender = true; this.schedule() }
  private onControlStart = () => { this.userMoved = true }

  private frame = (now: number) => {
    this.raf = 0
    if (this.disposed) return
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000))
    this.last = now
    if (this.dirty) this.applyPlan()
    let again = false
    if (this.tween) { again = this.stepTween(now); this.needsRender = true }
    else if (this.mode === 'eye') { if (this.stepEye(dt)) { again = true; this.needsRender = true } }
    else if (this.controls.enabled && this.controls.update()) { again = true; this.needsRender = true }
    if (this.needsRender) this.render()
    if (again) this.schedule()
  }

  private render() {
    this.needsRender = false
    if (!this.w || !this.h || this.lost) return
    // 조감에서는 보는 쪽을 가리는 벽을 낮춘다 (카메라가 돌 때마다 다시 고른다)
    if (this.plan3.cutWalls(this.flags.cut && this.mode === 'orbit' ? this.persp.position : null)) this.renderer.shadowMap.needsUpdate = true
    this.renderer.render(this.scene, this.cam)
  }

  private resize = () => {
    const w = Math.floor(this.host.clientWidth), h = Math.floor(this.host.clientHeight)
    if (w === this.w && h === this.h) return
    this.w = w; this.h = h
    if (!w || !h) return
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(w, h, false)
    this.persp.aspect = w / h
    this.persp.updateProjectionMatrix()
    this.sizeOrtho()
    // 아직 직접 돌려 보지 않았으면 새 크기에 다시 맞춘다 (칸을 크게 · 작게 바꿀 때)
    if (this.framed && !this.userMoved && !this.tween && this.mode !== 'eye') this.fit(false)
    if (this.dirty) this.applyPlan()
    this.render()
  }

  private onLost = (e: Event) => { e.preventDefault(); this.lost = true; this.on.lost(true) }
  private onRestored = () => { this.lost = false; this.on.lost(false); this.renderer.shadowMap.needsUpdate = true; this.invalidate() }

  private applyPlan() {
    this.dirty = false
    const p = this.pending
    if (!p || !this.plan3.sync(p.plan, p.look, p.selected)) return
    const info = this.plan3.info
    this.on.empty(info.empty)
    this.fitLights()
    this.applyFlags()
    this.renderer.shadowMap.needsUpdate = true
    this.needsRender = true
    if (info.empty) { this.framed = false; return }
    if (!this.framed) { this.fit(false); this.framed = true }
    else if (this.shifted()) this.fit(true)
    else if (this.mode === 'eye' && !this.tween) this.applyEye()
  }

  /** 평면이 크게 달라졌는지 (도면을 새로 불러왔을 때 다시 맞추려고) */
  private shifted(): boolean {
    const a = this.fitBox, b = this.sceneBox()
    if (a.isEmpty() || b.isEmpty()) return true
    const sa = a.getSize(new THREE.Vector3()), sb = b.getSize(new THREE.Vector3())
    const ra = Math.max(sa.x, sa.z, 1), rb = Math.max(sb.x, sb.z, 1)
    return rb > ra * 2.2 || rb < ra * 0.4 || a.getCenter(new THREE.Vector3()).distanceTo(b.getCenter(new THREE.Vector3())) > ra * 0.9
  }

  private sceneBox(): THREE.Box3 {
    const b = this.plan3.bounds.clone()
    if (!this.modelBox.isEmpty()) b.union(this.modelBox)
    return b
  }

  private nearScene(x: number, z: number): boolean {
    const b = this.plan3.bounds
    return !b.isEmpty() && x > b.min.x - 3 && x < b.max.x + 3 && z > b.min.z - 3 && z < b.max.z + 3
  }

  private afterModel() {
    this.fitLights()
    this.renderer.shadowMap.needsUpdate = true
    if (this.mode !== 'eye') this.fit(true)
    this.invalidate()
  }

  /** 해와 그림자 범위 · 땅 크기를 장면에 맞춘다 */
  private fitLights() {
    const box = this.sceneBox(), empty = box.isEmpty()
    const c = empty ? new THREE.Vector3(0, 1, 0) : box.getCenter(new THREE.Vector3())
    const r = empty ? 4 : Math.max(box.getSize(new THREE.Vector3()).length() / 2, 2)
    this.sun.target.position.copy(c)
    this.sun.position.copy(c).addScaledVector(SUN, r * 2.5 + 4)
    this.bounce.target.position.copy(c)
    this.bounce.position.set(c.x - 0.6, c.y - 10, c.z - 0.9)
    const sc = this.sun.shadow.camera
    sc.left = sc.bottom = -r * 1.12
    sc.right = sc.top = r * 1.12
    sc.near = 0.5
    sc.far = r * 5 + 12
    sc.updateProjectionMatrix()
    for (const g of [this.ground, this.catcher]) { g.position.x = c.x; g.position.z = c.z; g.scale.setScalar(r * 3.2 + 2) }
    this.persp.far = this.ortho.far = r * 40 + 300
    this.persp.updateProjectionMatrix()
    this.ortho.updateProjectionMatrix()
    this.controls.maxDistance = r * 12 + 10
  }

  private applyFlags() {
    const f = this.flags, inside = this.mode === 'eye'
    this.plan3.ceilG.visible = f.ceiling && inside && !this.tween
    let person = f.person && !this.plan3.info.empty
    // 눈높이에서 사람이 코앞이면 가린다
    if (person && inside) { const p = this.plan3.info.person; person = Math.hypot(p.x - this.persp.position.x, p.z - this.persp.position.z) > 0.9 }
    if (this.plan3.personG.visible !== person) { this.plan3.personG.visible = person; this.renderer.shadowMap.needsUpdate = true }
    if (this.sun.castShadow !== f.shadow) { this.sun.castShadow = f.shadow; this.renderer.shadowMap.needsUpdate = true }
    this.catcher.visible = f.shadow
    // 눈높이는 천장 아래: 해를 줄이고 둘레 빛을 올려 방 안이 고르게 밝게
    this.sun.intensity = inside ? 1.2 : 1.9
    this.hemi.intensity = inside ? 1.1 : 1.0
    this.bounce.intensity = inside ? 1.25 : 0
    this.scene.environmentIntensity = inside ? 0.65 : 0.6
  }

  // ── 카메라 ──────────────────────────────────────────────────────────

  private setPersp(p: Pose) {
    this.persp.position.copy(p.pos)
    this.persp.fov = p.fov
    this.persp.updateProjectionMatrix()
    this.aim.copy(p.target)
    this.persp.lookAt(p.target)
  }

  /** 조감: 전체가 들어오는 비스듬한 자리 */
  private orbitPose(): Pose {
    const box = this.sceneBox(), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3())
    if (box.isEmpty()) { c.set(0, 1, 0); s.set(5, 2.7, 4) }
    if (box.isEmpty()) box.setFromCenterAndSize(c, s)
    const az = rad(30), el = rad(46)
    const target = new THREE.Vector3(c.x, Math.min(s.y * 0.3, 1), c.z), n = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
    // 여덟 모서리가 모두 들어오는 거리를 구하고, 화면 한쪽으로 치우치지 않게 보는 점을 바닥을 따라 옮긴다
    const aspect = this.w && this.h ? this.w / this.h : 1.4, tv = Math.tan(rad(FOV) / 2) * (this.h > 420 ? 0.84 : 0.74), th = Math.tan(rad(FOV) / 2) * aspect * 0.94
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n).normalize(), up = new THREE.Vector3().crossVectors(n, right), away = new THREE.Vector3(-n.x, 0, -n.z).normalize(), q = new THREE.Vector3()
    const corner = (i: number) => q.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(target)
    let d = 1
    for (let pass = 0; pass < 4; pass++) {
      d = 1
      for (let i = 0; i < 8; i++) { const p = corner(i), depth = p.dot(n); d = Math.max(d, Math.abs(p.dot(right)) / th + depth, Math.abs(p.dot(up)) / tv + depth) }
      if (pass === 3) break
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
      for (let i = 0; i < 8; i++) { const p = corner(i), depth = Math.max(0.1, d - p.dot(n)), x = p.dot(right) / depth, y = p.dot(up) / depth; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
      target.addScaledVector(right, ((x0 + x1) / 2) * d).addScaledVector(away, (((y0 + y1) / 2) * d) / Math.sin(el))
    }
    return { pos: target.clone().addScaledVector(n, d), target, fov: FOV }
  }

  private topFit() {
    const box = this.sceneBox(), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3())
    if (box.isEmpty()) { c.set(0, 0, 0); s.set(5, 2.7, 4) }
    const aspect = this.w && this.h ? this.w / this.h : 1.4
    // 위쪽 도구 줄과 아래 안내 글에 가리지 않게 여백을 화면 크기에 맞춰 둔다
    const padV = this.h ? this.h / Math.max(this.h - 104, this.h * 0.5) : 1.2, padH = this.w ? this.w / Math.max(this.w - 40, this.w * 0.5) : 1.1
    return { center: new THREE.Vector3(c.x, 0, c.z), half: Math.max((s.z / 2) * padV, (s.x / 2 / aspect) * padH) + 0.1, height: (box.isEmpty() ? 3 : box.max.y) + 30 }
  }
  /** 위에서 보기와 같은 넓이가 보이는 원근 자리 (보기를 바꾸는 동안에 쓴다) */
  private topPose(): Pose {
    const t = this.topFit(), dist = t.half / Math.tan(rad(FOV) / 2)
    return { pos: new THREE.Vector3(t.center.x, dist, t.center.z + dist * 0.0006), target: t.center, fov: FOV }
  }

  private eyeHeight() { return Math.min(EYE_H, Math.max(0.6, this.plan3.info.H - 0.25)) }
  private eyePose(): Pose {
    const e = this.eye, pos = new THREE.Vector3(e.x, this.eyeHeight(), e.z)
    const dir = new THREE.Vector3(-Math.sin(e.yaw) * Math.cos(e.pitch), Math.sin(e.pitch), -Math.cos(e.yaw) * Math.cos(e.pitch))
    return { pos, target: pos.clone().addScaledVector(dir, 3), fov: EYE_FOV }
  }
  private resetEye() {
    const s = this.plan3.info.eye
    Object.assign(this.eye, { x: s.x, z: s.z, tx: s.x, tz: s.z, yaw: s.yaw, pitch: -0.05, set: true })
  }

  /** 지금 화면에 보이는 그대로의 원근 자리 */
  private currentPose(): Pose {
    if (this.cam === this.ortho) {
      const t = this.controls.target, dist = this.topHalf / this.ortho.zoom / Math.tan(rad(FOV) / 2)
      return { pos: new THREE.Vector3(t.x, dist, t.z + dist * 0.0006), target: new THREE.Vector3(t.x, 0, t.z), fov: FOV }
    }
    if (this.tween) return { pos: this.persp.position.clone(), target: this.aim.clone(), fov: this.persp.fov }
    if (this.mode === 'eye') return this.eyePose()
    return { pos: this.persp.position.clone(), target: this.controls.target.clone(), fov: this.persp.fov }
  }

  private enterOrbit(p: Pose) {
    const c = this.controls
    this.cam = this.persp
    c.object = this.persp
    c.target.copy(p.target)
    c.enableRotate = true
    c.minPolarAngle = 0.03
    c.maxPolarAngle = Math.PI / 2 - 0.03
    c.minAzimuthAngle = -Infinity
    c.maxAzimuthAngle = Infinity
    c.minDistance = 0.4
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
    c.enabled = true
    c.update()
  }

  private enterTop() {
    const t = this.topFit(), c = this.controls
    this.topHalf = t.half
    this.sizeOrtho()
    this.ortho.zoom = 1
    this.ortho.position.set(t.center.x, t.height, t.center.z)
    this.ortho.updateProjectionMatrix()
    this.cam = this.ortho
    c.object = this.ortho
    c.target.copy(t.center)
    // 돌리지 않는다: 끌면 옮기고 휠로 확대
    c.enableRotate = false
    c.minPolarAngle = c.maxPolarAngle = 0
    c.minAzimuthAngle = c.maxAzimuthAngle = 0
    c.minZoom = 0.3
    c.maxZoom = 14
    c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }
    c.enabled = true
    c.update()
  }

  private sizeOrtho() {
    const a = this.w / Math.max(this.h, 1) || 1.4
    this.ortho.left = -this.topHalf * a
    this.ortho.right = this.topHalf * a
    this.ortho.top = this.topHalf
    this.ortho.bottom = -this.topHalf
    this.ortho.updateProjectionMatrix()
  }

  private startTween(from: Pose, to: Pose, ms: number, done: () => void) {
    this.tween = { t0: performance.now(), ms, from, to, done }
    this.schedule()
  }
  private stepTween(now: number): boolean {
    const tw = this.tween!
    const k = Math.min(1, Math.max(0, (now - tw.t0) / tw.ms)), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
    this.persp.position.lerpVectors(tw.from.pos, tw.to.pos, e)
    this.aim.lerpVectors(tw.from.target, tw.to.target, e)
    this.persp.fov = tw.from.fov + (tw.to.fov - tw.from.fov) * e
    this.persp.updateProjectionMatrix()
    this.persp.lookAt(this.aim)
    if (k < 1) return true
    this.tween = null
    tw.done()
    return false
  }

  // ── 눈높이로 걷기 ─────────────────────────────────────────────────────

  private applyEye() {
    const e = this.eye
    if (this.persp.fov !== EYE_FOV) { this.persp.fov = EYE_FOV; this.persp.updateProjectionMatrix() }
    this.persp.position.set(e.x, this.eyeHeight(), e.z)
    this.persp.rotation.set(e.pitch, e.yaw, 0, 'YXZ')
    this.applyFlags()
  }

  private stepEye(dt: number): boolean {
    const e = this.eye, dx = e.tx - e.x, dz = e.tz - e.z, d = Math.hypot(dx, dz)
    if (d === 0) return false
    const k = d < 0.004 ? 1 : 1 - Math.exp(-dt * 8)
    e.x += dx * k; e.z += dz * k
    this.applyEye()
    return true
  }

  /** 벽을 뚫고 가지 않게: 가는 길이 벽에 닿으면 그 앞에서 멈추고, 벽에 너무 붙으면 밀어낸다 (문 자리는 지나간다) */
  private clip(x0: number, z0: number, x1: number, z1: number): [number, number] {
    const solids = this.plan3.info.solids, dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz)
    if (L < 1e-6) return [x0, z0]
    let t = 1
    for (const s of solids) {
      const ex = s.bx - s.ax, ez = s.bz - s.az, el = Math.hypot(ex, ez) || 1, pad = s.half + 0.05
      const ax = s.ax - (ex / el) * pad, az = s.az - (ez / el) * pad, bx = s.bx + (ex / el) * pad, bz = s.bz + (ez / el) * pad
      const den = dx * (bz - az) - dz * (bx - ax)
      if (Math.abs(den) < 1e-9) continue
      const tt = ((ax - x0) * (bz - az) - (az - z0) * (bx - ax)) / den, uu = ((ax - x0) * dz - (az - z0) * dx) / den
      if (tt >= 0 && tt <= 1 && uu >= 0 && uu <= 1) t = Math.min(t, Math.max(0, tt - (s.half + 0.4) / L))
    }
    let x = x0 + dx * t, z = z0 + dz * t
    for (let i = 0; i < 2; i++) for (const s of solids) {
      const ex = s.bx - s.ax, ez = s.bz - s.az, l2 = ex * ex + ez * ez || 1
      const u = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / l2)), qx = s.ax + ex * u, qz = s.az + ez * u
      const dist = Math.hypot(x - qx, z - qz), min = s.half + 0.3
      if (dist < min && dist > 1e-6) { x += ((x - qx) / dist) * (min - dist); z += ((z - qz) / dist) * (min - dist) }
    }
    return [x, z]
  }

  /** 두 번 누른 자리로 걸어간다: 바닥이면 그 자리, 벽 · 가구면 그 앞까지 */
  private walkToScreen(cx: number, cy: number) {
    const r = this.canvas.getBoundingClientRect(), e = this.eye
    if (!r.width || !r.height) return
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.persp)
    const hit = ray.intersectObjects(this.plan3.solidGroups, true).find(h => h.distance > 0.05)
    let tx: number, tz: number
    if (hit) {
      const up = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y : 0
      if (hit.point.y < 0.08 || (up > 0.7 && hit.point.y < 0.5)) { tx = hit.point.x; tz = hit.point.z }
      else { const dx = hit.point.x - e.x, dz = hit.point.z - e.z, d = Math.hypot(dx, dz) || 1, back = Math.min(0.7, d * 0.5); tx = hit.point.x - (dx / d) * back; tz = hit.point.z - (dz / d) * back }
    } else {
      const p = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())
      if (!p || p.distanceTo(this.persp.position) > 40) return
      tx = p.x; tz = p.z
    }
    const [x, z] = this.clip(e.x, e.z, tx, tz)
    e.tx = x; e.tz = z
    this.schedule()
  }

  private onDown = (e: PointerEvent) => {
    if (this.mode !== 'eye' || this.tween || (e.pointerType === 'mouse' && e.button !== 0)) return
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 }
    try { this.canvas.setPointerCapture(e.pointerId) } catch { /* 이미 끝난 누름 */ }
    this.canvas.style.cursor = 'grabbing'
  }
  private onMove = (e: PointerEvent) => {
    const d = this.drag
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy)
    // 화면을 잡아끄는 느낌: 오른쪽으로 끌면 왼쪽을 본다
    const k = rad(this.persp.fov) / Math.max(this.h, 1)
    this.eye.yaw += dx * k
    this.eye.pitch = Math.max(-1.2, Math.min(1.2, this.eye.pitch + dy * k))
    this.applyEye()
    this.invalidate()
  }
  private onUp = (e: PointerEvent) => {
    const d = this.drag
    if (!d || d.id !== e.pointerId) return
    this.drag = null
    this.canvas.style.cursor = this.mode === 'top' ? 'move' : 'grab'
    try { this.canvas.releasePointerCapture(e.pointerId) } catch { /* 잡은 적 없음 */ }
    if (e.type === 'pointercancel' || d.moved > 6) { this.lastTap = null; return }
    const now = performance.now(), t = this.lastTap
    if (t && now - t.at < 400 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 28) { this.lastTap = null; this.walkToScreen(e.clientX, e.clientY) }
    else this.lastTap = { at: now, x: e.clientX, y: e.clientY }
  }
  private onWheel = (e: WheelEvent) => {
    if (this.mode !== 'eye') return
    e.preventDefault()
    this.walkBy(Math.max(-1, Math.min(1, -e.deltaY / 100)) * 0.5)
  }
}

/** 열어 본 모델을 치울 때: 모양 · 재질 · 그림을 모두 버린다 */
function disposeTree(root: THREE.Object3D) {
  root.traverse(o => {
    const m = o as THREE.Mesh
    m.geometry?.dispose?.()
    for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose()
      mat.dispose()
    }
  })
}
