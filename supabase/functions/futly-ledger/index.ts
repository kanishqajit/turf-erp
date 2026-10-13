import { handleRequest } from './handler.mjs';
Deno.serve(req=>handleRequest(req,Deno.env));
