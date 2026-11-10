import { handleApiRequest } from './runtime/edge-api.mjs';
import { RELEASE } from './runtime/release.mjs';

Deno.serve(request=>handleApiRequest(request,Deno.env,fetch,RELEASE));
