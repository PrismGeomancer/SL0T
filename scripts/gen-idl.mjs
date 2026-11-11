#!/usr/bin/env node
// Writes an Anchor-0.31-format IDL for programs/sl0t, mirroring src/*.rs.
// Used before the Anchor toolchain is available. After `anchor build`, run
// `pnpm idl:sync` instead: it copies the compiler's target/idl/sl0t.json over
// this one. Keep this file in step with lib.rs / state.rs / events.rs / errors.rs.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const disc = (s) => Array.from(createHash('sha256').update(s).digest().subarray(0, 8));
const SYS = '11111111111111111111111111111111';
const IXS = 'Sysvar1nstructions1111111111111111111111111';

const programId = readFileSync(join(root, 'programs/sl0t/src/lib.rs'), 'utf8').match(/declare_id!\("(\w+)"\)/)[1];

const a = (name, o = {}) => ({ name, ...(o.w ? { writable: true } : {}), ...(o.s ? { signer: true } : {}), ...(o.address ? { address: o.address } : {}) });
const sys = a('system_program', { address: SYS });

const instructions = [
  ['init_config', [a('admin', { w: 1, s: 1 }), a('config', { w: 1 }), sys], [['params', { defined: { name: 'InitConfigParams' } }]]],
  ['update_config', [a('admin', { s: 1 }), a('config', { w: 1 })], [['params', { defined: { name: 'UpdateConfigParams' } }]]],
  ['add_friend', [a('admin', { w: 1, s: 1 }), a('config'), a('friend', { w: 1 }), sys], [['wallet', 'pubkey']]],
  ['remove_friend', [a('admin', { w: 1, s: 1 }), a('config'), a('friend', { w: 1 })], [['wallet', 'pubkey']]],
  ['register_launch', [a('creator', { w: 1, s: 1 }), a('config'), a('friend'), a('mint'), a('bonding_curve'), a('launch', { w: 1 }), a('vault', { w: 1 }), a('creator_stake', { w: 1 }), a('instructions', { address: IXS }), sys], []],
  ['stake', [a('owner', { w: 1, s: 1 }), a('config'), a('friend'), a('launch', { w: 1 }), a('vault', { w: 1 }), a('stake', { w: 1 }), sys], [['side', { defined: { name: 'Side' } }], ['amount', 'u64']]],
  ['stake_rematch', [a('owner', { w: 1, s: 1 }), a('config'), a('friend'), a('launch', { w: 1 }), a('vault', { w: 1 }), a('stake', { w: 1 }), a('rematch', { w: 1 }), sys], [['side', { defined: { name: 'Side' } }], ['expected_amount', 'u64']]],
  ['resolve', [a('resolver', { s: 1 }), a('launch', { w: 1 }), a('bonding_curve'), a('pump_global')], []],
  ['claim', [a('owner', { w: 1, s: 1 }), a('launch', { w: 1 }), a('vault', { w: 1 }), a('stake', { w: 1 }), sys], []],
  ['claim_loss', [a('owner', { w: 1, s: 1 }), a('config'), a('launch', { w: 1 }), a('stake', { w: 1 }), a('rematch', { w: 1 }), sys], []],
  ['sweep_dust', [a('admin', { s: 1 }), a('config'), a('launch'), a('vault', { w: 1 }), a('creator', { w: 1 }), sys], []],
].map(([name, accounts, args]) => ({ name, discriminator: disc(`global:${name}`), accounts, args: args.map(([n, t]) => ({ name: n, type: t })) }));

const f = (pairs) => pairs.map(([name, type]) => ({ name, type }));
const struct = (name, pairs) => ({ name, type: { kind: 'struct', fields: f(pairs) } });
const enm = (name, variants) => ({ name, type: { kind: 'enum', variants: variants.map((v) => ({ name: v })) } });
const D = (name) => ({ defined: { name } });
const opt = (t) => ({ option: t });

const types = [
  struct('Config', [['admin', 'pubkey'], ['keeper', 'pubkey'], ['pump_program', 'pubkey'], ['launch_fee_lamports', 'u64'], ['max_stake_lamports', 'u64'], ['window_secs', 'i64'], ['stake_close_secs', 'i64'], ['rematch_secs', 'i64'], ['paused', 'bool'], ['bump', 'u8']]),
  struct('Friend', [['wallet', 'pubkey'], ['added_at', 'i64'], ['bump', 'u8']]),
  enm('LaunchState', ['Open', 'Hit', 'Miss', 'Void']),
  enm('Side', ['Hit', 'Miss']),
  struct('Launch', [['creator', 'pubkey'], ['mint', 'pubkey'], ['bonding_curve', 'pubkey'], ['pump_program', 'pubkey'], ['opened_at', 'i64'], ['deadline', 'i64'], ['stake_close_at', 'i64'], ['resolved_at', 'i64'], ['state', D('LaunchState')], ['hit_total', 'u64'], ['miss_total', 'u64'], ['stake_count', 'u32'], ['settled_count', 'u32'], ['evidence_slot', 'u64'], ['evidence_pct_bps', 'u16'], ['evidence_complete', 'bool'], ['vault_bump', 'u8'], ['bump', 'u8']]),
  struct('Stake', [['owner', 'pubkey'], ['launch', 'pubkey'], ['side', D('Side')], ['amount', 'u64'], ['is_rematch', 'bool'], ['claimed', 'bool'], ['bump', 'u8']]),
  struct('Rematch', [['owner', 'pubkey'], ['amount_lost', 'u64'], ['source_launch', 'pubkey'], ['expires_at', 'i64'], ['used', 'bool'], ['bump', 'u8']]),
  struct('InitConfigParams', [['keeper', 'pubkey'], ['pump_program', 'pubkey'], ['launch_fee_lamports', 'u64'], ['max_stake_lamports', 'u64'], ['window_secs', 'i64'], ['stake_close_secs', 'i64'], ['rematch_secs', 'i64']]),
  struct('UpdateConfigParams', [['admin', opt('pubkey')], ['keeper', opt('pubkey')], ['pump_program', opt('pubkey')], ['launch_fee_lamports', opt('u64')], ['max_stake_lamports', opt('u64')], ['window_secs', opt('i64')], ['stake_close_secs', opt('i64')], ['rematch_secs', opt('i64')], ['paused', opt('bool')]]),
  struct('ConfigUpdated', [['admin', 'pubkey'], ['keeper', 'pubkey'], ['pump_program', 'pubkey'], ['launch_fee_lamports', 'u64'], ['max_stake_lamports', 'u64'], ['window_secs', 'i64'], ['stake_close_secs', 'i64'], ['rematch_secs', 'i64'], ['paused', 'bool']]),
  struct('FriendAdded', [['wallet', 'pubkey']]),
  struct('FriendRemoved', [['wallet', 'pubkey']]),
  struct('LaunchRegistered', [['launch', 'pubkey'], ['mint', 'pubkey'], ['creator', 'pubkey'], ['fee', 'u64'], ['opened_at', 'i64'], ['deadline', 'i64'], ['stake_close_at', 'i64']]),
  struct('Staked', [['launch', 'pubkey'], ['mint', 'pubkey'], ['owner', 'pubkey'], ['side', D('Side')], ['amount', 'u64'], ['is_rematch', 'bool'], ['hit_total', 'u64'], ['miss_total', 'u64']]),
  struct('Resolved', [['launch', 'pubkey'], ['mint', 'pubkey'], ['state', D('LaunchState')], ['hit_total', 'u64'], ['miss_total', 'u64'], ['evidence_slot', 'u64'], ['evidence_pct_bps', 'u16'], ['curve_complete', 'bool'], ['resolver', 'pubkey']]),
  struct('Claimed', [['launch', 'pubkey'], ['mint', 'pubkey'], ['owner', 'pubkey'], ['side', D('Side')], ['amount', 'u64'], ['payout', 'u64'], ['state', D('LaunchState')]]),
  struct('LossSettled', [['launch', 'pubkey'], ['mint', 'pubkey'], ['owner', 'pubkey'], ['side', D('Side')], ['amount', 'u64'], ['rematch_amount', 'u64'], ['rematch_expires_at', 'i64']]),
  struct('DustSwept', [['launch', 'pubkey'], ['mint', 'pubkey'], ['to', 'pubkey'], ['lamports', 'u64']]),
];

const accountNames = ['Config', 'Friend', 'Launch', 'Rematch', 'Stake'];
const eventNames = ['Claimed', 'ConfigUpdated', 'DustSwept', 'FriendAdded', 'FriendRemoved', 'LaunchRegistered', 'LossSettled', 'Resolved', 'Staked'].filter((n) => types.some((t) => t.name === n));

const errorsSrc = readFileSync(join(root, 'programs/sl0t/src/errors.rs'), 'utf8');
const errors = [...errorsSrc.matchAll(/#\[msg\("([^"]+)"\)\]\s*(\w+),/g)].map((m, i) => ({ code: 6000 + i, name: m[2], msg: m[1] }));

const idl = {
  address: programId,
  metadata: { name: 'sl0t', version: '0.1.0', spec: '0.1.0', description: 'SL0T: a friends-only pump.fun launchpad with HIT/MISS pools and rematches' },
  instructions,
  accounts: accountNames.map((name) => ({ name, discriminator: disc(`account:${name}`) })),
  events: eventNames.map((name) => ({ name, discriminator: disc(`event:${name}`) })),
  errors,
  types,
};

const out = JSON.stringify(idl, null, 2) + '\n';
for (const p of ['app/src/idl/sl0t.json', 'keeper/src/idl/sl0t.json', 'tests/idl/sl0t.json']) {
  mkdirSync(dirname(join(root, p)), { recursive: true });
  writeFileSync(join(root, p), out);
}
console.log(`IDL for ${programId}: ${instructions.length} instructions, ${errors.length} errors`);
