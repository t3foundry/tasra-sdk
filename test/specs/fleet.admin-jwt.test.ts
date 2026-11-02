import {describe, expect, it} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {mintAdminJwt, mintLocalJwt, type FleetConfig} from '../fleet/_fleet.ts'

function config(): FleetConfig {
  return {jwtSigningKey:'11'.repeat(32),jwtIss:'verifier-issuer',jwtAud:'read-service',
    adminJwtSigningKey:'22'.repeat(32),adminJwtIss:'operator-issuer',adminJwtAud:'keeper-admin'} as FleetConfig
}

function decode(token:string) {
  const [header,body,signature]=token.split('.')
  return {header:JSON.parse(Buffer.from(header!,'base64url').toString()) as Record<string,unknown>,
    body:JSON.parse(Buffer.from(body!,'base64url').toString()) as Record<string,unknown>,
    signature:Buffer.from(signature!,'base64url'),message:new TextEncoder().encode(header+'.'+body)}
}

describe('fleet admin issuer separation',()=>{
  it('signs admin and read tokens with separate keys, headers and audiences',()=>{
    const cfg=config(),admin=decode(mintAdminJwt(cfg)),user=decode(mintLocalJwt(cfg))
    expect(admin.header).toEqual({typ:'kk-admin+jwt',alg:'EdDSA'})
    expect(admin.body).toMatchObject({iss:'operator-issuer',aud:'keeper-admin',sub:'platform-operator',scope:['admin']})
    expect(user.header).toEqual({typ:'JWT',alg:'EdDSA'})
    expect(user.body).toMatchObject({iss:'verifier-issuer',aud:'read-service'})
    expect(user.body.scope).not.toContain('admin')
    const adminKey=ed25519.getPublicKey(Buffer.from(cfg.adminJwtSigningKey,'hex'))
    const userKey=ed25519.getPublicKey(Buffer.from(cfg.jwtSigningKey,'hex'))
    expect(ed25519.verify(admin.signature,admin.message,adminKey)).toBe(true)
    expect(ed25519.verify(admin.signature,admin.message,userKey)).toBe(false)
    expect(ed25519.verify(user.signature,user.message,userKey)).toBe(true)
    expect(ed25519.verify(user.signature,user.message,adminKey)).toBe(false)
  })

  it('refuses absent, invalid or shared admin keys and incomplete admin identity',()=>{
    for(const change of [{adminJwtSigningKey:''},{adminJwtSigningKey:'xyz'},
      {adminJwtSigningKey:config().jwtSigningKey},{adminJwtIss:''},{adminJwtAud:' '}]){
      expect(()=>mintAdminJwt({...config(),...change})).toThrow()
    }
    expect(()=>mintAdminJwt(config(),{signingKey:config().jwtSigningKey})).toThrow(/different keys/)
    // Losing the separate admin issuer never makes the user credential stronger.
    expect(decode(mintLocalJwt({...config(),adminJwtSigningKey:''})).header.typ).toBe('JWT')
  })

  it('keeps governance capabilities on the admin issuer and audit reads on the user issuer',()=>{
    const cfg=config()
    expect(decode(mintAdminJwt(cfg,{scope:['governance:sign','EmployeeOf:dept=Engineering']})).body.scope)
      .toEqual(['governance:sign','EmployeeOf:dept=Engineering'])
    expect(decode(mintLocalJwt(cfg,{scope:['audit:read']})).body.scope).toEqual(['audit:read'])
  })
})
