import {scrypt as derive,randomBytes,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(derive);
export function credentials(body) {
  if(!body || typeof body.email!=='string' || typeof body.password!=='string')return null;
  const email=body.email.trim().toLowerCase();
  if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || body.password.length<12 || body.password.length>128)return null;
  return {email,password:body.password};
}
export async function passwordHash(password,salt=randomBytes(16).toString('hex')) {
  return {salt,digest:(await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:33554432})).toString('hex')};
}
export async function passwordMatches(password,record) {
  const result=await passwordHash(password,record?.salt || '00000000000000000000000000000000');
  const expected=Buffer.from(record?.digest || '00'.repeat(64),'hex');
  return expected.length===64 && timingSafeEqual(Buffer.from(result.digest,'hex'),expected) && Boolean(record);
}
