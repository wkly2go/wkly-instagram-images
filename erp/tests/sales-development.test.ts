import {test} from 'node:test'
import assert from 'node:assert/strict'
import {developmentProgress,developmentTarget,salesDevelopmentCheckpoint as checkpoint} from '../src/lib/salesDevelopment.ts'

test('development progress counts each gate, not a draft as operational completion',()=>{
 const result=developmentProgress(checkpoint.milestones)
 assert.deepEqual(result,{total:48,completed:30,percent:62,remaining:38,byGate:[8,8,8,6]})
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

test('70 percent requires thirty-four gates, and targets never round up current completion',()=>{
 assert.deepEqual(developmentTarget(checkpoint.milestones,70),{required:34,remainingGates:4,minimumPercent:70,reached:false})
 assert.equal(developmentTarget(checkpoint.milestones,31).reached,true)
 assert.equal(developmentTarget(checkpoint.milestones,100).remainingGates,18)
 for(const invalid of [-1,101,NaN,40.5])assert.throws(()=>developmentTarget(checkpoint.milestones,invalid))
})
