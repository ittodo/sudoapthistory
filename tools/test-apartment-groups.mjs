import test from 'node:test';
import assert from 'node:assert/strict';
import {selectApartmentMember} from '../js/apartment-groups.mjs';
test('member selection retains canonical ID, source rows and its own price summary',()=>{
 const a={id:'canonical',sources:['A','B','R'],displayGroup:{members:[{key:'A',name:'대우'},{key:'B',name:'럭키'},{key:'R',name:'임대'}]},areas:[{area:84,total:7,latest:{price:400},rows:[{source:'A',i:7,commentId:'apt_7'},{source:'B',i:8,commentId:'apt_8'}],memberSummaries:{A:{total:3,latest:{price:100}},B:{total:4,latest:{price:400}}}}]};
 const out=selectApartmentMember(a,'A');assert.equal(out.id,'canonical');assert.deepEqual(out.sources,['A']);assert.equal(out.areas[0].latest.price,100);assert.equal(out.areas[0].total,3);assert.equal(out.areas[0].rows[0].commentId,'apt_7');
 assert.equal(a.areas[0].total,7);assert.equal(selectApartmentMember(a),a);assert.deepEqual(selectApartmentMember(a,'R').sources,['R']);assert.deepEqual(selectApartmentMember(a,'R').areas,[]);
});
