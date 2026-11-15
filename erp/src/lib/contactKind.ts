/** Whether a stored contact is a person, a company's shared address, or an automated service notice. */
export type ContactKind='사람'|'회사 창구'|'서비스 알림'|'미분류'
export interface ContactLike {title?:string|null;name?:string|null;brand?:string|null;email?:string|null;instagram?:string|null;note?:string|null}
const AUTOMATED=/^(no-?reply|noreply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer(-daemon)?|bounces?|postmaster|newsletter|news|digest|billing|invoices?|receipts?|payments?|accounts?|security|verify|verification|welcome|updates?|system|admin|root|.*-api|api|bot|automated|auto)$/
const SHARED=/^(info|contact|contacts|sales|biz|business|marketing|mkt|pr|press|media|partner|partners|partnership|alliance|cs|service|customer|help|support|hello|hi|team|office|inquiry|inquiries|ask|webmaster|master|ceo|recruit|hr|jobs|careers|store|shop|order|orders|event|events|popup|brand|official)$/
const NOTICE=/(welcome to|verify your|verification code|인증\s?(번호|코드)|영수증|결제\s?(완료|내역)|invoice|receipt|구독|unsubscribe|수신거부|password|비밀번호|보안 알림|가입을 환영|계정\s?(생성|확인))/i
const FREE=/@(gmail|naver|daum|hanmail|kakao|nate|outlook|hotmail|icloud|yahoo)\./
const personName=(v:string)=>/^[가-힣]{2,4}$/.test(v)||/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(v)
export function contactKind(c:ContactLike):ContactKind{
 const email=(c.email??'').trim().toLowerCase(),local=email.split('@')[0]??'',name=(c.name??'').trim()
 const text=[c.title,c.note].filter(Boolean).join(' ')
 if(email&&(AUTOMATED.test(local)||NOTICE.test(text)))return '서비스 알림'
 if(name&&personName(name)&&name!==(c.brand??'').trim())return '사람'
 if(email&&SHARED.test(local))return '회사 창구'
 if(email&&(FREE.test(email)||/^[a-z]+[._][a-z]+$/.test(local)))return '사람'
 if(!email&&c.instagram)return c.brand?'회사 창구':'미분류'
 return '미분류'
}
