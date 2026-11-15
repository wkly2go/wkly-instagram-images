import {test} from 'node:test'
import assert from 'node:assert/strict'
import {contactKind} from '../src/lib/contactKind.ts'
test('service notices, shared company addresses and people are told apart',()=>{
 assert.equal(contactKind({title:'Brave Search API',email:'search-api@brave.com',note:'Welcome to Brave Search API'}),'서비스 알림')
 assert.equal(contactKind({email:'no-reply@accounts.example.com'}),'서비스 알림');assert.equal(contactKind({email:'kim@brand.co.kr',note:'인증번호 안내'}),'서비스 알림')
 assert.equal(contactKind({brand:'폴뉴아',email:'partner@folnua.com'}),'회사 창구');assert.equal(contactKind({email:'info@brand.co.kr'}),'회사 창구');assert.equal(contactKind({brand:'모노커피',instagram:'@monocoffee'}),'회사 창구')
 assert.equal(contactKind({name:'김민수',brand:'모노커피',email:'marketing@mono.kr'}),'사람');assert.equal(contactKind({email:'minsu.kim@brand.co.kr'}),'사람');assert.equal(contactKind({email:'someone88@gmail.com'}),'사람');assert.equal(contactKind({name:'Jane Park',email:'jp@brand.com'}),'사람')
 assert.equal(contactKind({email:'mk77@brand.co.kr'}),'미분류');assert.equal(contactKind({}),'미분류');assert.equal(contactKind({name:'모노커피',brand:'모노커피',email:'x1@mono.kr'}),'미분류')
})
