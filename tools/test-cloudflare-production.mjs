import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyProduction} from './verify-cloudflare-production.mjs';

const source=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const contract={schema:1,provider:'cloudflare',productionOrigin:'https://nodostream.com'};
const env={GITHUB_REF:'refs/heads/main',CLOUDFLARE_PRODUCTION_ENABLED:'true',NODESTREAM_DEPLOYMENT_PROVIDER:'cloudflare',CLOUDFLARE_ACCOUNT_ID:'90ef0cc5b9fc89e9005b5ca905ae2b6e',CLOUDFLARE_PRODUCTION_D1_ID:'11111111-2222-4333-8444-555555555555',CLOUDFLARE_WORKERS_PLAN:'free'};
function fixture(){const c=structuredClone(source);delete c.env.production.limits;c.env.production.d1_databases[0].database_id=env.CLOUDFLARE_PRODUCTION_D1_ID;return c;}
test('production gate fails closed for unprepared, cross-environment and unapproved deployments',()=>{
 assert.throws(()=>verifyProduction(source,contract,env));
 verifyProduction(fixture(),contract,env);
 for(const change of [{GITHUB_REF:'refs/heads/cloudflare-staging'},{CLOUDFLARE_PRODUCTION_ENABLED:''},{NODESTREAM_DEPLOYMENT_PROVIDER:'github-pages'},{CLOUDFLARE_ACCOUNT_ID:'other'},{CLOUDFLARE_PRODUCTION_D1_ID:'00000000-0000-0000-0000-000000000000'},{CLOUDFLARE_PRODUCTION_D1_ID:'636d41b6-3ed7-4f6d-8f0b-823324c4ccad'},{CLOUDFLARE_WORKERS_PLAN:''},{CLOUDFLARE_WORKERS_PLAN:'paid'}])assert.throws(()=>verifyProduction(fixture(),contract,{...env,...change}));
 for(const mutate of [c=>c.env.production.name='nodostream-staging',c=>c.env.production.d1_databases=source.d1_databases,c=>c.env.production.workers_dev=true,c=>c.env.production.routes=[{pattern:'app.nodostream.com',custom_domain:true}],c=>c.routes=['nodostream.com/*'],c=>c.env.production.vars.MAINTENANCE='false',c=>c.env.production.vars.AUTH_ENABLED='true',c=>c.env.production.limits={cpu_ms:50}]){const c=fixture();mutate(c);assert.throws(()=>verifyProduction(c,contract,env));}
 assert.throws(()=>verifyProduction(fixture(),{...contract,provider:'github-pages'},env));
});
test('production gate requires separate paid, authentication and write approvals',()=>{
 const c=fixture();c.env.production.limits={cpu_ms:50};
 verifyProduction(c,contract,{...env,CLOUDFLARE_WORKERS_PLAN:'paid',CLOUDFLARE_PAID_APPROVED:'true'});
 delete c.env.production.limits;c.env.production.vars.AUTH_ENABLED='true';c.env.production.vars.GOOGLE_CLIENT_ID=source.vars.GOOGLE_CLIENT_ID;
 const auth={...env,CLOUDFLARE_PRODUCTION_AUTH_APPROVED:'true'};verifyProduction(c,contract,auth);
 c.env.production.vars.MAINTENANCE='false';assert.throws(()=>verifyProduction(c,contract,auth));
 verifyProduction(c,contract,{...auth,CLOUDFLARE_PRODUCTION_WRITES_APPROVED:'true'});
});
