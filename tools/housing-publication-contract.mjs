// Publication identity is distinct from each workbench item's approval state.
export const currentReviewContract='current-review-publication-v1';

export function housingPublicationMode(housing,map){
  const h=housing?.meta,m=map?.meta;
  if(h?.candidateOnly===true||m?.candidateOnly===true)throw Error('Candidate metadata cannot be used for production');
  const current=[h?.contract,m?.contract].some(c=>typeof c==='string'&&c.startsWith('current-review-'));
  if(current){
    if(h?.contract!==currentReviewContract||m?.contract!==currentReviewContract||h.candidateOnly!==false||m.candidateOnly!==false||h.approvedOnly!==false)
      throw Error('Invalid current review publication contract');
    if(typeof h.sourceVersion!=='string'||!h.sourceVersion.trim()||typeof m.sourceVersion!=='string'||!m.sourceVersion.trim()||m.publicationSourceVersion!==h.sourceVersion)
      throw Error('Current review publication source version mismatch');
    return 'current-review';
  }
  if(h?.approvedOnly!==true)throw Error('Publication metadata must use approved apartment identities');
  return 'legacy';
}
