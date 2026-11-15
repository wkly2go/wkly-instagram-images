import {test} from 'node:test'
import assert from 'node:assert/strict'
import {developmentProgress,developmentTarget,salesDevelopmentCheckpoint as checkpoint} from '../src/lib/salesDevelopment.ts'

test('development progress counts each gate, not a draft as operational completion',()=>{
 const result=developmentProgress(checkpoint.milestones)
 assert.deepEqual(result,{total:48,completed:38,percent:79,remaining:21,byGate:[10,10,10,8]})
 assert.equal(developmentProgress([{name:'Draft',gates:[true,true,false,false],evidence:'Local only'}]).percent,50)
 assert.equal(developmentProgress([]).percent,0)
 assert.equal(developmentProgress([{name:'Verified',gates:[true,true,true,true],evidence:'Full evidence'}]).remaining,0)
})
test('every recorded gate has evidence and later gates require preceding verification',()=>{
 assert.equal(new Set(checkpoint.milestones.map(row=>row.name)).size,checkpoint.milestones.length)
 for(const row of checkpoint.milestones){
  assert.ok(row.evidence.length>0)
  row.gates.forEach((done,index)=>{if(done&&index>0)assert.equal(row.gates[index-1],true,row.name)})
 }
 assert.ok(Number.isFinite(Date.parse(checkpoint.updatedAt)))
})

test('80 percent requires thirty-nine gates, and targets never round up current completion',()=>{
 assert.deepEqual(developmentTarget(checkpoint.milestones,80),{required:39,remainingGates:1,minimumPercent:81,reached:false})
 assert.equal(developmentTarget(checkpoint.milestones,70).reached,true)
 assert.equal(developmentTarget(checkpoint.milestones,100).remainingGates,10)
 for(const invalid of [-1,101,NaN,40.5])assert.throws(()=>developmentTarget(checkpoint.milestones,invalid))
})
