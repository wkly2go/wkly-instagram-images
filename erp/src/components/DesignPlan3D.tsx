// 평면을 그대로 세운 3D 보기 (블록 수준). three 는 이 화면을 열 때만 불러온다.
// 레퍼런스: 아키스케치 · Coohom — 평면을 고치면 3D 가 바로 따라온다. 정밀 모델 · 렌더는 스케치업(Enscape)에서 한다.
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { wallLength, type PlanGeometry } from '../lib/designPlan'

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

export default function DesignPlan3D({ plan, selected }: { plan: PlanGeometry; selected: string | null }) {
  const host = useRef<HTMLDivElement>(null)
  const ctx = useRef<{ scene: THREE.Scene; group: THREE.Group; camera: THREE.PerspectiveCamera; controls: OrbitControls; render: () => void; framed: boolean } | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(css('--paper', '#f7f7f5'))
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)
    scene.add(new THREE.HemisphereLight(0xffffff, 0xbfc4b8, 1.5))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(6, 12, 4)
    scene.add(sun)
    const group = new THREE.Group()
    scene.add(group)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.maxPolarAngle = Math.PI / 2 - 0.02
    const render = () => renderer.render(scene, camera)
    controls.addEventListener('change', render)
    const fit = () => {
      const w = el.clientWidth || 300, h = el.clientHeight || 300
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      render()
    }
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    ctx.current = { scene, group, camera, controls, render, framed: false }
    fit()
    return () => {
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      ctx.current = null
    }
  }, [])

  useEffect(() => {
    const c = ctx.current
    if (!c) return
    for (const o of [...c.group.children]) {
      c.group.remove(o)
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      ;(Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x?.dispose())
    }
    const blue = css('--blue', '#0b5a24'), pink = css('--pink', '#fd37be')
    const mat = (color: string, opacity = 1) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: opacity < 1, opacity })
    const H = plan.height / 1000
    const box = new THREE.Box3()
    for (const w of plan.walls) {
      const len = wallLength(w) / 1000
      if (len <= 0) continue
      const holes = plan.openings.filter(o => o.wall === w.id).sort((a, b) => a.pos - b.pos)
      const angle = Math.atan2(w.y2 - w.y1, w.x2 - w.x1)
      const color = w.id === selected ? pink : w.kind === 'new' ? '#e9e4d6' : '#c9c9c4'
      // 문 · 창 자리는 비우고 벽을 조각으로 세운다 (문 위 · 창 위아래는 채움)
      const parts: { from: number; to: number; y0: number; y1: number }[] = []
      let cur = 0
      for (const o of holes) {
        const a = Math.max(0, (o.pos - o.width / 2) / 1000), b = Math.min(len, (o.pos + o.width / 2) / 1000)
        if (a > cur) parts.push({ from: cur, to: a, y0: 0, y1: H })
        if (o.kind === 'door') parts.push({ from: a, to: b, y0: Math.min(2.1, H), y1: H })
        else { parts.push({ from: a, to: b, y0: 0, y1: 0.9 }); parts.push({ from: a, to: b, y0: Math.min(2.1, H), y1: H }) }
        cur = Math.max(cur, b)
      }
      if (cur < len) parts.push({ from: cur, to: len, y0: 0, y1: H })
      for (const p of parts) {
        if (p.to - p.from <= 0.001 || p.y1 - p.y0 <= 0.001) continue
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.to - p.from, p.y1 - p.y0, w.t / 1000), mat(color))
        const mid = (p.from + p.to) / 2
        mesh.position.set(w.x1 / 1000 + Math.cos(angle) * mid, (p.y0 + p.y1) / 2, w.y1 / 1000 + Math.sin(angle) * mid)
        mesh.rotation.y = -angle
        c.group.add(mesh)
        box.expandByObject(mesh)
      }
    }
    for (const it of plan.items) {
      const w = (it.rot === 90 ? it.d : it.w) / 1000, d = (it.rot === 90 ? it.w : it.d) / 1000, h = Math.max(it.h, 20) / 1000
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(it.id === selected ? pink : blue, 0.92))
      mesh.position.set(it.x / 1000 + w / 2, h / 2, it.y / 1000 + d / 2)
      c.group.add(mesh)
      box.expandByObject(mesh)
    }
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3())
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(size.x + 2, size.z + 2), mat('#ffffff'))
      floor.rotation.x = -Math.PI / 2
      floor.position.set(center.x, -0.002, center.z)
      c.group.add(floor)
      if (!c.framed) {
        const r = Math.max(size.x, size.z, 3)
        c.camera.position.set(center.x + r * 0.9, r * 1.1, center.z + r * 1.2)
        c.controls.target.set(center.x, 0.6, center.z)
        c.controls.update()
        c.framed = true
      }
    }
    c.render()
  }, [plan, selected])

  return <div ref={host} className="design-plan-3d" role="img" aria-label="평면을 세운 3D 보기. 끌어서 돌리고, 휠로 확대합니다" />
}
