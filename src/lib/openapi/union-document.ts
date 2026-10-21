import { z } from "zod";
import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { accessDecisionInput, accessRequestInput, accessRevokeInput, launcherClaimInput, launcherStartInput, unionSiteInput } from "../union-contract";
import { directorySchema, errorSchema } from "./schemas";
import type { Locale } from "../i18n";
import { unionSyncStatusSchema } from "../union-directory-contract";
import { avatarMetadataSchema, avatarRevisionInput } from "../organization-avatar-contract";
extendZodWithOpenApi(z);

const id=z.string().uuid(), date=z.string().datetime({offset:true}), ok=z.object({ok:z.literal(true)});
const org=z.object({id,displayName:z.string()}).strict();
const request=z.object({id,sourceOrganizationId:id,targetOrganizationId:id,accountId:id,createdById:id,serverIds:z.array(z.string()),autoIncludeNewServers:z.boolean(),reason:z.string(),status:z.enum(["PENDING","APPROVED","REJECTED","CANCELLED"]),revision:z.number().int(),reviewedById:id.nullable(),reviewedAt:date.nullable(),note:z.string(),createdAt:date,sourceName:z.string(),targetName:z.string(),memberName:z.string()}).strict();
const grant=z.object({id,requestId:id,sourceOrganizationId:id,targetOrganizationId:id,accountId:id,serverIds:z.array(z.string()),autoIncludeNewServers:z.boolean(),approvedAt:date,revokedAt:date.nullable(),revokedById:id.nullable(),revokeReason:z.string().nullable(),sourceName:z.string(),targetName:z.string(),memberName:z.string()}).strict();
type ExtraOperation={method:"get"|"post"|"put"|"delete";path:string;id:string;zh:string;en:string;auth:"session"|"member"|"launcher"|"public";body?:z.ZodTypeAny;query?:z.AnyZodObject;response?:z.ZodTypeAny;status?:number;redirect?:boolean;superadmin?:boolean;multipart?:boolean;binary?:boolean};
export const unionOperations:ExtraOperation[]=[
  {method:"get",path:"/api/admin/union-sync",id:"getUnionSync",zh:"读取联盟目录同步状态",en:"Read Union directory synchronization status",auth:"session",superadmin:true,response:unionSyncStatusSchema},
  {method:"post",path:"/api/admin/union-sync",id:"requestUnionSync",zh:"安排立即同步联盟目录",en:"Schedule immediate Union directory synchronization",auth:"session",superadmin:true,body:z.object({}).strict(),response:ok},
  {method:"get",path:"/api/admin/organizations/{organizationId}/avatar-image",id:"getOrganizationAvatar",zh:"读取组织头像、原图或裁剪资料",en:"Read organization avatar, original image or crop metadata",auth:"session",query:z.object({variant:z.enum(["image","source","metadata"]).optional(),version:z.string().optional()}),response:avatarMetadataSchema,binary:true},
  {method:"post",path:"/api/admin/organizations/{organizationId}/avatar-image",id:"uploadOrganizationAvatar",zh:"上传或重新裁剪组织头像",en:"Upload or recrop organization avatar",auth:"session",multipart:true,body:z.object({source:z.string().openapi({format:"binary"}).optional(),crop:z.string(),expectedRevision:z.string().regex(/^\d+$/)}).strict(),response:z.object({ok:z.literal(true),revision:z.number().int()}).strict()},
  {method:"delete",path:"/api/admin/organizations/{organizationId}/avatar-image",id:"removeOrganizationAvatar",zh:"移除组织头像并保留人工选择",en:"Remove organization avatar and preserve manual preference",auth:"session",body:avatarRevisionInput,response:z.object({ok:z.literal(true),revision:z.number().int()}).strict()},
  {method:"get",path:"/api/auth/union/start",id:"startUnionLogin",zh:"开始 Union OAuth 登录",en:"Start Union OAuth login",auth:"public",query:z.object({returnTo:z.string().optional()}),redirect:true},
  {method:"get",path:"/api/auth/union/callback",id:"completeUnionLogin",zh:"处理 Union OAuth 回调",en:"Complete Union OAuth login",auth:"public",query:z.object({code:z.string().optional(),state:z.string(),error:z.string().optional()}),redirect:true},
  {method:"post",path:"/api/auth/launcher/start",id:"startLauncherLogin",zh:"创建 Launcher 登录请求",en:"Start a Launcher login attempt",auth:"public",body:launcherStartInput,response:z.object({id,loginUrl:z.string().url(),expiresAt:date}).strict(),status:201},
  {method:"post",path:"/api/auth/launcher/claim",id:"claimLauncherLogin",zh:"领取 Launcher 只读会话",en:"Claim a Launcher read-only session",auth:"public",body:launcherClaimInput,response:z.union([z.object({pending:z.literal(true)}).strict(),z.object({pending:z.literal(false),token:z.string().regex(/^mul_[a-f0-9]{64}$/),expiresAt:date}).strict()])},
  {method:"post",path:"/api/auth/launcher/approve",id:"approveLauncherLogin",zh:"浏览器确认 Launcher 登录",en:"Confirm Launcher login in the browser",auth:"session",body:z.object({id}).strict(),response:ok},
  {method:"post",path:"/api/auth/launcher/logout",id:"logoutLauncher",zh:"撤销当前 Launcher 会话",en:"Revoke the current Launcher session",auth:"launcher",response:ok},
  {method:"get",path:"/api/member",id:"getMemberDirectory",zh:"读取成员身份与资源目录",en:"Read member identity and resource directory",auth:"member",response:z.object({actor:z.object({id,displayName:z.string(),canManage:z.boolean()}).strict(),organizations:z.array(org),servers:directorySchema.shape.servers}).strict()},
  {method:"get",path:"/api/admin/union-sites",id:"listUnionSites",zh:"列出皮肤站组织映射",en:"List skin-site organization mappings",auth:"session",superadmin:true,response:z.array(unionSiteInput.omit({revision:true}).extend({revision:z.number().int(),updatedAt:date}))},
  {method:"put",path:"/api/admin/union-sites",id:"saveUnionSite",zh:"保存皮肤站组织映射",en:"Save a skin-site organization mapping",auth:"session",superadmin:true,body:unionSiteInput,response:unionSiteInput.extend({updatedAt:date})},
  {method:"get",path:"/api/admin/access/candidates",id:"getAccessCandidates",zh:"列出跨组织访问候选资源",en:"List cross-organization access candidates",auth:"session",query:z.object({sourceOrganizationId:id,targetOrganizationId:id.optional()}),response:z.union([z.array(org),directorySchema.shape.servers])},
  {method:"get",path:"/api/admin/access/requests",id:"listAccessRequests",zh:"列出访问申请与授权",en:"List access requests and grants",auth:"session",response:z.object({requests:z.array(request),grants:z.array(grant)}).strict()},
  {method:"post",path:"/api/admin/access/requests",id:"submitAccessRequest",zh:"为本组织成员申请访问",en:"Request access for a home-organization member",auth:"session",body:accessRequestInput,response:z.object({id}).strict(),status:201},
  {method:"post",path:"/api/admin/access/requests/{id}",id:"decideAccessRequest",zh:"审批或取消访问申请",en:"Decide or cancel an access request",auth:"session",body:accessDecisionInput,response:ok},
  {method:"post",path:"/api/admin/access/grants/{id}/revoke",id:"revokeAccessGrant",zh:"撤销跨组织访问授权",en:"Revoke cross-organization access",auth:"session",body:accessRevokeInput,response:ok},
];
export function unionOpenApi(locale:Locale){
 const registry=new OpenAPIRegistry();const en=locale==="en-US";
 for(const op of unionOperations){
  const errors=Object.fromEntries([400,401,403,404,409,413,415,422,429,500,502,503].map(code=>[code,{description:en?"Invalid input, identity, permission, resource state or provider response.":"参数、身份、权限、资源状态或上游响应错误。",content:{"application/json":{schema:errorSchema}}}]));
  const response={description:en?"Successful response. Permissions are checked live.":"成功响应；权限逐请求检查。",content:{"application/json":{schema:op.response??ok},...(op.binary?{"image/webp":{schema:z.string().openapi({format:"binary"})}}:{})}};
  registry.registerPath({method:op.method,path:op.path,operationId:op.id,tags:[op.path.startsWith("/api/admin")?"Administration":"Authentication"],summary:en?op.en:op.zh,
   description:en?"OAuth uses an independent five-minute Lax cookie, one-use state and S256 PKCE. Launcher sessions are read-only. Cross-organization changes require authorized administrator Cookie sessions and same-origin protection. IDs and auto-new rules are bound to the approved request revision.":"OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。",
   security:op.auth==="public"?[]:op.auth==="member"?[{SessionCookie:[]},{LauncherToken:[]}]:op.auth==="launcher"?[{LauncherToken:[]}]:[{SessionCookie:[]}],"x-superadmin-only":!!op.superadmin,
   request:{params:op.path.includes("{")?z.object(Object.fromEntries([...op.path.matchAll(/\{(\w+)\}/g)].map(m=>[m[1],id]))):undefined,query:op.query,body:op.body?{required:true,content:{[op.multipart?"multipart/form-data":"application/json"]:{schema:op.body}}}:undefined,
    headers:op.method!=="get"&&op.auth==="session"?z.object({Origin:z.string()}):undefined},
   responses:op.redirect?{303:{description:en?"Browser redirect; login result or sanitized error. No OAuth credentials in response bodies.":"浏览器跳转到登录结果或脱敏错误页；不返回 OAuth 凭据。",headers:{Location:{schema:{type:"string"}},"Set-Cookie":{schema:{type:"string"}}}},...errors}:{[op.status??200]:response,...(op.id==="claimLauncherLogin"?{202:response}:{}),...errors}});
 }
 return new OpenApiGeneratorV31(registry.definitions).generateDocument({openapi:"3.1.0",info:{title:"Union Link",version:"3.2.0"}});
}
