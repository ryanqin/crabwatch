import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_HOOK_PORT, HOOK_PATH } from './hookServer.js';
import { HOOK_EVENTS } from './hookInstaller.js';

export interface RemoteProfile {
  id: string;
  label: string;
  host: string;
  user: string;
  /** ssh 端口，默认 22 */
  port?: number;
  identityFile?: string;
}

export type RemoteStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface RemoteState {
  profileId: string;
  status: RemoteStatus;
  message?: string;
}

const PROFILES_PATH = path.join(os.homedir(), '.crabwatch', 'remotes.json');

/** 反向隧道：远程 127.0.0.1:port → 本地 hookServer，远程 hook 直接 curl 本地口 */
function sshTunnelArgs(p: RemoteProfile, port: number): string[] {
  const args = [
    '-N',
    '-T',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=3',
    '-o',
    'ExitOnForwardFailure=yes',
    '-R',
    `${port}:127.0.0.1:${port}`,
  ];
  if (p.port) args.push('-p', String(p.port));
  if (p.identityFile) args.push('-i', p.identityFile);
  args.push(`${p.user}@${p.host}`);
  return args;
}

/** 远程合并 hook 进 ~/.claude/settings.json 的 Node 脚本（命令带 ?remote=label 标记来源） */
function buildDeployScript(p: RemoteProfile, port: number): string {
  const events = JSON.stringify(HOOK_EVENTS);
  const url = `http://127.0.0.1:${port}${HOOK_PATH}?remote=${encodeURIComponent(p.label)}`;
  const longUrl = `${url}`;
  // 远程 Node 一行脚本：幂等合并（按 HOOK_PATH 识别自己的条目）
  return [
    `const fs=require('fs'),os=require('os'),path=require('path');`,
    `const f=path.join(os.homedir(),'.claude','settings.json');`,
    `let s={};try{s=JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){}`,
    `s.hooks=s.hooks||{};`,
    `const EV=${events};`,
    `const cmd=ev=>(ev==='PermissionRequest'||ev==='Elicitation')`,
    `?'curl -s -m 55 -X POST -H \\'Content-Type: application/json\\' --data-binary @- \\'${longUrl}\\' 2>/dev/null || true'`,
    `:'curl -s -m 2 -X POST -H \\'Content-Type: application/json\\' --data-binary @- \\'${longUrl}\\' >/dev/null 2>&1 || true';`,
    `for(const ev of EV){const g=Array.isArray(s.hooks[ev])?s.hooks[ev]:[];`,
    `const others=g.filter(x=>!(x.hooks||[]).some(h=>(h.command||'').includes('${HOOK_PATH}')));`,
    `s.hooks[ev]=[...others,{matcher:'',hooks:[{type:'command',command:cmd(ev)}]}];}`,
    `fs.writeFileSync(f,JSON.stringify(s,null,2)+'\\n');`,
    `console.log('crabwatch hooks deployed: '+EV.length+' events');`,
  ].join('');
}

/** SSH 反向隧道生命周期管理：连接/断开/状态/掉线重连 + 远程 hook 部署 */
export class RemoteManager extends EventEmitter {
  private profiles: RemoteProfile[] = [];
  private children = new Map<string, ChildProcess>();
  private states = new Map<string, RemoteState>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private wantConnected = new Set<string>();

  async load(): Promise<RemoteProfile[]> {
    try {
      this.profiles = JSON.parse(
        await fsp.readFile(PROFILES_PATH, 'utf8'),
      ) as RemoteProfile[];
    } catch {
      this.profiles = [];
    }
    return this.profiles;
  }

  list(): RemoteProfile[] {
    return this.profiles;
  }

  statesList(): RemoteState[] {
    return this.profiles.map(
      (p) =>
        this.states.get(p.id) ?? { profileId: p.id, status: 'disconnected' },
    );
  }

  private async save(): Promise<void> {
    await fsp.mkdir(path.dirname(PROFILES_PATH), { recursive: true });
    await fsp.writeFile(PROFILES_PATH, JSON.stringify(this.profiles, null, 2));
  }

  async upsert(p: RemoteProfile): Promise<RemoteProfile[]> {
    const i = this.profiles.findIndex((x) => x.id === p.id);
    if (i >= 0) this.profiles[i] = p;
    else this.profiles.push(p);
    await this.save();
    return this.profiles;
  }

  async remove(id: string): Promise<RemoteProfile[]> {
    this.disconnect(id);
    this.profiles = this.profiles.filter((x) => x.id !== id);
    await this.save();
    return this.profiles;
  }

  private setState(profileId: string, status: RemoteStatus, message?: string) {
    const st = { profileId, status, message };
    this.states.set(profileId, st);
    this.emit('state', st);
  }

  /** ssh 跑远程 Node 脚本把 hook 装到远程（需要远程有 node） */
  deployHooks(id: string, port = DEFAULT_HOOK_PORT): Promise<string> {
    const p = this.profiles.find((x) => x.id === id);
    if (!p) return Promise.reject(new Error('profile not found'));
    const sshArgs: string[] = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
    if (p.port) sshArgs.push('-p', String(p.port));
    if (p.identityFile) sshArgs.push('-i', p.identityFile);
    sshArgs.push(`${p.user}@${p.host}`, 'node', '-e', buildDeployScript(p, port));
    return new Promise((resolve, reject) => {
      const ch = spawn('ssh', sshArgs);
      let out = '';
      let err = '';
      ch.stdout.on('data', (d) => (out += d));
      ch.stderr.on('data', (d) => (err += d));
      ch.on('close', (code) =>
        code === 0
          ? resolve(out.trim() || 'deployed')
          : reject(new Error(err.trim() || `ssh exit ${code}`)),
      );
      ch.on('error', (e) => reject(e));
    });
  }

  connect(id: string, port = DEFAULT_HOOK_PORT): void {
    const p = this.profiles.find((x) => x.id === id);
    if (!p) return;
    this.wantConnected.add(id);
    this.spawnTunnel(p, port);
  }

  private spawnTunnel(p: RemoteProfile, port: number) {
    this.killChild(p.id);
    this.setState(p.id, 'connecting');
    const ch = spawn('ssh', sshTunnelArgs(p, port));
    this.children.set(p.id, ch);
    // -N 隧道不输出；连上后短延迟无错即视为 connected
    const upTimer = setTimeout(() => {
      if (this.children.get(p.id) === ch) this.setState(p.id, 'connected');
    }, 2500);
    let stderr = '';
    ch.stderr.on('data', (d) => {
      stderr += String(d);
      if (/permission denied|could not resolve|connection refused|timed out/i.test(stderr))
        this.setState(p.id, 'error', stderr.split('\n')[0].slice(0, 120));
    });
    ch.on('close', (code) => {
      clearTimeout(upTimer);
      this.children.delete(p.id);
      if (!this.wantConnected.has(p.id)) {
        this.setState(p.id, 'disconnected');
        return;
      }
      // 想连着却掉了：标错 + 10s 后重连
      this.setState(
        p.id,
        'error',
        stderr.split('\n')[0]?.slice(0, 120) || `ssh exited (${code})`,
      );
      const t = setTimeout(() => {
        if (this.wantConnected.has(p.id)) this.spawnTunnel(p, port);
      }, 10_000);
      this.reconnectTimers.set(p.id, t);
    });
    ch.on('error', (e) =>
      this.setState(p.id, 'error', (e as Error).message.slice(0, 120)),
    );
  }

  private killChild(id: string) {
    const t = this.reconnectTimers.get(id);
    if (t) {
      clearTimeout(t);
      this.reconnectTimers.delete(id);
    }
    const ch = this.children.get(id);
    if (ch) {
      ch.removeAllListeners('close');
      ch.kill();
      this.children.delete(id);
    }
  }

  disconnect(id: string): void {
    this.wantConnected.delete(id);
    this.killChild(id);
    this.setState(id, 'disconnected');
  }

  stop(): void {
    for (const id of [...this.children.keys()]) {
      this.wantConnected.delete(id);
      this.killChild(id);
    }
  }
}
