import {test} from 'node:test'
import assert from 'node:assert/strict'
import {duplicateMigrationNumbers,compareMigrationNumbers} from '../scripts/check-migration-numbers.mjs'
test('same migration inherited by both branches is not a collision',()=>{
 assert.deepEqual(duplicateMigrationNumbers(['erp/supabase/migrations/0125_sales.sql','erp/supabase/migrations/0125_sales.sql']),[])
})
test('historical collisions are reported separately, without hiding a new third file',()=>{
 const base=['0079_old_a.sql','0079_old_b.sql']
 assert.equal(compareMigrationNumbers(base,base).existing.length,1)
 assert.equal(compareMigrationNumbers(base,base).introduced.length,0)
 assert.equal(compareMigrationNumbers(base,[...base,'0079_new.sql']).introduced.length,1)
})
test('a newly published parallel migration conflicts with the working branch',()=>{
 assert.equal(compareMigrationNumbers(['0125_design.sql'],['0125_sales.sql']).introduced.length,1)
})
test('different files using the same number fail even across different padding',()=>{
 const conflicts=duplicateMigrationNumbers(['erp/supabase/migrations/0125_sales.sql','erp/supabase/migrations/125_other.sql','README.md'])
 assert.equal(conflicts.length,1);assert.equal(conflicts[0][0],'125');assert.equal(conflicts[0][1].length,2)
})
