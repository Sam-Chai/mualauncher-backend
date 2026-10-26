import { z } from "zod";
import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { accessDecisionInput, accessRequestInput, accessRevokeInput, launcherClaimInput, launcherStartInput, unionSiteInput } from "../union-contract";
import { directorySchema, errorSchema } from "./schemas";
import { translator, type Locale } from "../i18n";
import { unionSyncStatusSchema } from "../union-directory-contract";
import { avatarMetadataSchema, avatarRevisionInput } from "../organization-avatar-contract";
import { gameLoginErrorSchema, gameLoginExchangeInput, gameLoginExchangeResult, gameLoginStartInput, gameLoginStartResult, launcherProviderInput, launcherProviderPublic, launcherProviderRecord } from "../launcher-game-contract";
extendZodWithOpenApi(z);

const id=z.string().uuid(), date=z.string().datetime({offset:true}), ok=z.object({ok:z.literal(true)});
const org=z.object({id,displayName:z.string()}).strict();
const request=z.object({id,sourceOrganizationId:id,targetOrganizationId:id,accountId:id,createdById:id,serverIds:z.array(z.string()),autoIncludeNewServers:z.boolean(),reason:z.string(),status:z.enum(["PENDING","APPROVED","REJECTED","CANCELLED"]),revision:z.number().int(),reviewedById:id.nullable(),reviewedAt:date.nullable(),note:z.string(),createdAt:date,sourceName:z.string(),targetName:z.string(),memberName:z.string()}).strict();
const grant=z.object({id,requestId:id,sourceOrganizationId:id,targetOrganizationId:id,accountId:id,serverIds:z.array(z.string()),autoIncludeNewServers:z.boolean(),approvedAt:date,revokedAt:date.nullable(),revokedById:id.nullable(),revokeReason:z.string().nullable(),sourceName:z.string(),targetName:z.string(),memberName:z.string()}).strict();
type ExtraOperation={method:"get"|"post"|"put"|"delete";path:string;id:string;summaryKey:string;auth:"session"|"member"|"launcher"|"public";body?:z.ZodTypeAny;query?:z.ZodObject;response?:z.ZodTypeAny;status?:number;redirect?:boolean;superadmin?:boolean;multipart?:boolean;binary?:boolean;game?:boolean;descriptionKey?:string};
export const PUBLIC_AUTH_OPERATION_IDS = ["startLauncherLogin", "claimLauncherLogin", "logoutLauncher", "getMemberDirectory", "listLauncherProviders", "startLauncherGameLogin", "exchangeLauncherGameLogin"] as const;
export const unionOperations:ExtraOperation[]=[
  {method:"get",path:"/api/auth/launcher/providers",id:"listLauncherProviders",summaryKey:"api.operations.listLauncherProviders.summary",auth:"public",game:true,response:z.array(launcherProviderPublic),
    descriptionKey:"api.operations.listLauncherProviders.description"},
  {method:"post",path:"/api/auth/launcher/yggdrasil/start",id:"startLauncherGameLogin",summaryKey:"api.operations.startLauncherGameLogin.summary",auth:"public",game:true,body:gameLoginStartInput,response:gameLoginStartResult,status:201,
    descriptionKey:"api.operations.startLauncherGameLogin.description"},
  {method:"post",path:"/api/auth/launcher/yggdrasil/exchange",id:"exchangeLauncherGameLogin",summaryKey:"api.operations.exchangeLauncherGameLogin.summary",auth:"public",game:true,body:gameLoginExchangeInput,response:gameLoginExchangeResult,
    descriptionKey:"api.operations.exchangeLauncherGameLogin.description"},
  {method:"get",path:"/api/admin/launcher-providers",id:"listLauncherProvidersAdmin",summaryKey:"api.operations.listLauncherProvidersAdmin.summary",auth:"session",superadmin:true,response:z.array(launcherProviderRecord)},
  {method:"put",path:"/api/admin/launcher-providers",id:"saveLauncherProvider",summaryKey:"api.operations.saveLauncherProvider.summary",auth:"session",superadmin:true,body:launcherProviderInput,response:launcherProviderRecord,
    descriptionKey:"api.operations.saveLauncherProvider.description"},
  {method:"get",path:"/api/admin/union-sync",id:"getUnionSync",summaryKey:"api.operations.getUnionSync.summary",auth:"session",superadmin:true,response:unionSyncStatusSchema},
  {method:"post",path:"/api/admin/union-sync",id:"requestUnionSync",summaryKey:"api.operations.requestUnionSync.summary",auth:"session",superadmin:true,body:z.object({}).strict(),response:ok},
  {method:"get",path:"/api/admin/organizations/{organizationId}/avatar-image",id:"getOrganizationAvatar",summaryKey:"api.operations.getOrganizationAvatar.summary",auth:"session",query:z.object({variant:z.enum(["image","source","metadata"]).optional(),version:z.string().optional()}),response:avatarMetadataSchema,binary:true},
  {method:"post",path:"/api/admin/organizations/{organizationId}/avatar-image",id:"uploadOrganizationAvatar",summaryKey:"api.operations.uploadOrganizationAvatar.summary",auth:"session",multipart:true,body:z.object({source:z.string().openapi({format:"binary"}).optional(),crop:z.string(),expectedRevision:z.string().regex(/^\d+$/)}).strict(),response:z.object({ok:z.literal(true),revision:z.number().int()}).strict()},
  {method:"delete",path:"/api/admin/organizations/{organizationId}/avatar-image",id:"removeOrganizationAvatar",summaryKey:"api.operations.removeOrganizationAvatar.summary",auth:"session",body:avatarRevisionInput,response:z.object({ok:z.literal(true),revision:z.number().int()}).strict()},
  {method:"get",path:"/api/auth/union/start",id:"startUnionLogin",summaryKey:"api.operations.startUnionLogin.summary",auth:"public",query:z.object({returnTo:z.string().optional()}),redirect:true},
  {method:"get",path:"/api/auth/union/callback",id:"completeUnionLogin",summaryKey:"api.operations.completeUnionLogin.summary",auth:"public",query:z.object({code:z.string().optional(),state:z.string(),error:z.string().optional()}),redirect:true},
  {method:"post",path:"/api/auth/launcher/start",id:"startLauncherLogin",summaryKey:"api.operations.startLauncherLogin.summary",auth:"public",body:launcherStartInput,response:z.object({id,loginUrl:z.string().url(),expiresAt:date}).strict(),status:201},
  {method:"post",path:"/api/auth/launcher/claim",id:"claimLauncherLogin",summaryKey:"api.operations.claimLauncherLogin.summary",auth:"public",body:launcherClaimInput,response:z.union([z.object({pending:z.literal(true)}).strict(),z.object({pending:z.literal(false),token:z.string().regex(/^mul_[a-f0-9]{64}$/),expiresAt:date}).strict()])},
  {method:"post",path:"/api/auth/launcher/approve",id:"approveLauncherLogin",summaryKey:"api.operations.approveLauncherLogin.summary",auth:"session",body:z.object({id}).strict(),response:ok},
  {method:"post",path:"/api/auth/launcher/logout",id:"logoutLauncher",summaryKey:"api.operations.logoutLauncher.summary",auth:"launcher",response:ok},
  {method:"get",path:"/api/member",id:"getMemberDirectory",summaryKey:"api.operations.getMemberDirectory.summary",auth:"member",response:z.object({actor:z.object({id,displayName:z.string(),canManage:z.boolean()}).strict(),organizations:z.array(org),servers:directorySchema.shape.servers}).strict()},
  {method:"get",path:"/api/admin/union-sites",id:"listUnionSites",summaryKey:"api.operations.listUnionSites.summary",auth:"session",superadmin:true,response:z.array(unionSiteInput.omit({revision:true}).extend({revision:z.number().int(),updatedAt:date}))},
  {method:"put",path:"/api/admin/union-sites",id:"saveUnionSite",summaryKey:"api.operations.saveUnionSite.summary",auth:"session",superadmin:true,body:unionSiteInput,response:unionSiteInput.extend({updatedAt:date})},
  {method:"get",path:"/api/admin/access/candidates",id:"getAccessCandidates",summaryKey:"api.operations.getAccessCandidates.summary",auth:"session",query:z.object({sourceOrganizationId:id,targetOrganizationId:id.optional()}),response:z.union([z.array(org),directorySchema.shape.servers])},
  {method:"get",path:"/api/admin/access/requests",id:"listAccessRequests",summaryKey:"api.operations.listAccessRequests.summary",auth:"session",response:z.object({requests:z.array(request),grants:z.array(grant)}).strict()},
  {method:"post",path:"/api/admin/access/requests",id:"submitAccessRequest",summaryKey:"api.operations.submitAccessRequest.summary",auth:"session",body:accessRequestInput,response:z.object({id}).strict(),status:201},
  {method:"post",path:"/api/admin/access/requests/{id}",id:"decideAccessRequest",summaryKey:"api.operations.decideAccessRequest.summary",auth:"session",body:accessDecisionInput,response:ok},
  {method:"post",path:"/api/admin/access/grants/{id}/revoke",id:"revokeAccessGrant",summaryKey:"api.operations.revokeAccessGrant.summary",auth:"session",body:accessRevokeInput,response:ok},
];
export function unionOpenApi(locale:Locale, launcherOnly = false){
 const registry=new OpenAPIRegistry();const t=translator(locale);
 for(const op of unionOperations){
  if(launcherOnly && !(PUBLIC_AUTH_OPERATION_IDS as readonly string[]).includes(op.id)) continue;
  const errors=Object.fromEntries([400,401,403,404,409,413,415,422,429,500,502,503].map(code=>[code,{description:t("api.union.invalid"),content:{"application/json":{schema:op.game?gameLoginErrorSchema:errorSchema}},headers:{"Cache-Control":{schema:{type:"string" as const,const:"private, no-store"}}}}]));
  const response={description:t("api.union.successful"),headers:{"Cache-Control":{schema:{type:"string" as const,const:"private, no-store"}}},content:{"application/json":{schema:op.response??ok},...(op.binary?{"image/webp":{schema:z.string().openapi({format:"binary"})}}:{})}};
  registry.registerPath({method:op.method,path:op.path,operationId:op.id,tags:[op.path.startsWith("/api/admin")?"Administration":"Authentication"],summary:t(op.summaryKey),
   description:(op.descriptionKey?t(op.descriptionKey):undefined)??(t("api.union.oauth")),
   ...(op.game&&op.method==="post"?{"x-request-body-max-bytes":32768}:{}),
   security:op.auth==="public"?[]:op.auth==="member"?[{SessionCookie:[]},{LauncherToken:[]}]:op.auth==="launcher"?[{LauncherToken:[]}]:[{SessionCookie:[]}],"x-superadmin-only":!!op.superadmin,
   request:{params:op.path.includes("{")?z.object(Object.fromEntries([...op.path.matchAll(/\{(\w+)\}/g)].map(m=>[m[1],id]))):undefined,query:op.query,body:op.body?{required:true,content:{[op.multipart?"multipart/form-data":"application/json"]:{schema:op.body}}}:undefined,
    headers:op.method!=="get"&&op.auth==="session"?z.object({Origin:z.string()}):undefined},
   responses:op.redirect?{303:{description:t("api.union.browser"),headers:{Location:{schema:{type:"string"}},"Set-Cookie":{schema:{type:"string"}}}},...errors}:{[op.status??200]:response,...(op.id==="claimLauncherLogin"?{202:response}:{}),...errors}});
 }
 return new OpenApiGeneratorV31(registry.definitions).generateDocument({openapi:"3.1.0",info:{title:"Union Link",version:"5.0.0"}});
}
