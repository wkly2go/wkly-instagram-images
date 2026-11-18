// PC 프로그램 업데이트 표(latest.yml · latest-mac.yml)를 보관함 맨 위에 둘 때 파일 주소에 버전 폴더를 붙임
//  - electron-builder 가 만든 표는 'url: WKLY-Intranet-Setup.exe' 처럼 이름만 → 'url: v1.29.0/WKLY-Intranet-Setup.exe'
//  - 이미 폴더가 붙어 있으면 이름만 떼어 다시 붙임 · 가리키는 파일 이름 목록을 함께 돌려줌 (빠진 파일 확인용)
export function versionedFeed(text: string, version: string): { text: string; files: string[] } {
  const files: string[] = []
  const out = text.replace(/^([ \t]*(?:-[ \t]+)?(?:url|path):[ \t]*)(['"]?)([^'"\s]+)\2[ \t]*$/gm, (_m, head: string, _q: string, name: string) => {
    const base = name.split('/').pop()!
    files.push(base)
    return `${head}v${version}/${base}`
  })
  return { text: out, files: [...new Set(files)] }
}
