export const LOOKUP_SECRETS = {
  bizinfo: 'BIZINFO_API_KEY',
  preSpec: 'DATA_GO_KR_PRE_SPEC_KEY',
  orderPlan: 'DATA_GO_KR_ORDER_PLAN_KEY',
  contractProcess: 'DATA_GO_KR_CONTRACT_PROCESS_KEY',
  award: 'DATA_GO_KR_AWARD_KEY',
  contract: 'DATA_GO_KR_CONTRACT_KEY',
  seoulEvents: 'SEOUL_CULTURAL_EVENT_API_KEY',
  seoulPopulation: 'SEOUL_COMMERCIAL_AREA_POPULATION_API_KEY',
  kakao: 'KAKAO_REST_API_KEY',
  district: 'DATA_GO_KR_COMMERCIAL_DISTRICT_KEY',
  buildingRegister: 'DATA_GO_KR_BUILDING_REGISTER_KEY',
  buildingPermit: 'DATA_GO_KR_BUILDING_PERMIT_KEY',
  restaurant: 'DATA_GO_KR_RESTAURANT_LICENSE_KEY',
} as const

export type LookupSource = keyof typeof LOOKUP_SECRETS
export const OTHER_SECRETS = {
  bidNotice: 'DATA_GO_KR_SERVICE_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  seoulLegacy: 'SEOUL_OPEN_DATA_API_KEY',
  naverId: 'NAVER-API-ID',
  naverSecret: 'NAVER_API_SECRET',
  youtube: 'WKLY 유튜브 인트라넷',
} as const

export type SecretStatusId = LookupSource | keyof typeof OTHER_SECRETS
export type LookupConfiguration = Partial<Record<SecretStatusId, boolean>>

export function isLookupSource(value: unknown): value is LookupSource {
  return typeof value === 'string' && Object.hasOwn(LOOKUP_SECRETS, value)
}

export function isSampleLookup(source: LookupSource): boolean {
  return source === 'seoulEvents' || source === 'seoulPopulation'
}
