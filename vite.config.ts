// vite.config.ts

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { buildVersionLabel } from './src/lib/build-version';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite';
import { configDefaults } from 'vitest/config';

// closed-source modules (AI Agent, future tiered features) live in the
// private repo, checked out into ./modules on desktop builds; open-source
// builds resolve '@modules' to the empty stub manifest
const modulesDir = path.resolve(__dirname, './modules/index.ts');
const modulesTarget = fs.existsSync(modulesDir)
    ? modulesDir
    : path.resolve(__dirname, './src/modules-stub/index.ts');
// In the split public/private worktree, ./modules is a symlink into the
// private checkout. Vite resolves Worker URLs to that real path, so explicitly
// allow the resolved modules directory without hard-coding either repository.
const modulesAllowDir = path.dirname(fs.realpathSync(modulesTarget));
const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
) as { version?: string };

function shioajiLocalWatchlistPlugin(): import('vite').Plugin {
    const watchlistsFile = path.resolve(__dirname, 'watchlists.json');
    function loadWatchlists() {
        if (fs.existsSync(watchlistsFile)) {
            try {
                return JSON.parse(fs.readFileSync(watchlistsFile, 'utf8'));
            } catch {}
        }
        const defaultLists = [
            {
                id: 'default',
                name: '我的自選',
                contracts: [
                    { security_type: 'STK', exchange: 'TSE', code: '2330' },
                    { security_type: 'STK', exchange: 'TSE', code: '2317' },
                    { security_type: 'STK', exchange: 'TSE', code: '2454' },
                    { security_type: 'STK', exchange: 'TSE', code: '2603' },
                    { security_type: 'STK', exchange: 'TSE', code: '0050' },
                    { security_type: 'FUT', exchange: 'TAIFEX', code: 'TXFR1' },
                ],
            },
        ];
        fs.writeFileSync(watchlistsFile, JSON.stringify(defaultLists, null, 2), 'utf8');
        return defaultLists;
    }
    function saveWatchlists(lists: any) {
        fs.writeFileSync(watchlistsFile, JSON.stringify(lists, null, 2), 'utf8');
    }

    return {
        name: 'shioaji-local-watchlist',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const url = req.url?.split('?')[0];
                if (url === '/api/v1/data/index_components') {
                    res.setHeader('Content-Type', 'application/json');
                    res.statusCode = 404;
                    res.end(JSON.stringify({ code: 404, message: 'Index components not available in simulation mode' }));
                    return;
                }
                if (url === '/api/v1/watchlist') {
                    if (req.method === 'GET') {
                        res.setHeader('Content-Type', 'application/json');
                        res.statusCode = 200;
                        res.end(JSON.stringify(loadWatchlists()));
                        return;
                    }
                    if (req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => body += chunk);
                        req.on('end', () => {
                            const parsed = JSON.parse(body || '{}');
                            const lists = loadWatchlists();
                            const newList = {
                                id: 'wl_' + Date.now(),
                                name: parsed.name || '自選清單',
                                contracts: parsed.contracts || [],
                            };
                            lists.push(newList);
                            saveWatchlists(lists);
                            res.setHeader('Content-Type', 'application/json');
                            res.statusCode = 200;
                            res.end(JSON.stringify(newList));
                        });
                        return;
                    }
                }
                const match = url?.match(/^\/api\/v1\/watchlist\/([^\/]+)(.*)$/);
                if (match) {
                    const encodedWatchlistId = match[1];
                    if (!encodedWatchlistId) {
                        next();
                        return;
                    }
                    const id = decodeURIComponent(encodedWatchlistId);
                    const subpath = match[2];
                    if (subpath === '' || subpath === '/') {
                        if (req.method === 'PUT') {
                            let body = '';
                            req.on('data', chunk => body += chunk);
                            req.on('end', () => {
                                const parsed = JSON.parse(body || '{}');
                                const lists = loadWatchlists();
                                const target = lists.find((l: any) => l.id === id);
                                if (target) {
                                    if (parsed.contracts) target.contracts = parsed.contracts;
                                    if (parsed.name) target.name = parsed.name;
                                    saveWatchlists(lists);
                                    res.setHeader('Content-Type', 'application/json');
                                    res.statusCode = 200;
                                    res.end(JSON.stringify(target));
                                } else {
                                    res.statusCode = 404;
                                    res.end(JSON.stringify({ error: 'not found' }));
                                }
                            });
                            return;
                        }
                        if (req.method === 'DELETE') {
                            let lists = loadWatchlists();
                            lists = lists.filter((l: any) => l.id !== id);
                            saveWatchlists(lists);
                            res.setHeader('Content-Type', 'application/json');
                            res.statusCode = 200;
                            res.end(JSON.stringify({ ok: true }));
                            return;
                        }
                    } else if (subpath === '/contracts') {
                        if (req.method === 'POST') {
                            let body = '';
                            req.on('data', chunk => body += chunk);
                            req.on('end', () => {
                                const parsed = JSON.parse(body || '{}');
                                const lists = loadWatchlists();
                                const target = lists.find((l: any) => l.id === id);
                                if (target) {
                                    for (const c of (parsed.contracts || [])) {
                                        if (!target.contracts.some((x: any) => x.code === c.code)) {
                                            target.contracts.push(c);
                                        }
                                    }
                                    saveWatchlists(lists);
                                    res.setHeader('Content-Type', 'application/json');
                                    res.statusCode = 200;
                                    res.end(JSON.stringify(target));
                                } else {
                                    res.statusCode = 404;
                                    res.end(JSON.stringify({ error: 'not found' }));
                                }
                            });
                            return;
                        }
                        if (req.method === 'DELETE') {
                            let body = '';
                            req.on('data', chunk => body += chunk);
                            req.on('end', () => {
                                const parsed = JSON.parse(body || '{}');
                                const lists = loadWatchlists();
                                const target = lists.find((l: any) => l.id === id);
                                if (target) {
                                    const toRemove = new Set((parsed.contracts || []).map((c: any) => c.code));
                                    target.contracts = target.contracts.filter((c: any) => !toRemove.has(c.code));
                                    saveWatchlists(lists);
                                    res.setHeader('Content-Type', 'application/json');
                                    res.statusCode = 200;
                                    res.end(JSON.stringify(target));
                                } else {
                                    res.statusCode = 404;
                                    res.end(JSON.stringify({ error: 'not found' }));
                                }
                            });
                            return;
                        }
                    }
                }
                next();
            });
        },
    };
}


export default defineConfig(({ mode, command }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const devPort = command === 'serve' ? env.VITE_DEV_SERVER_PORT : undefined;
    const isolatedApi = devPort ? `http://127.0.0.1:${Number(devPort)}` : undefined;
    if (devPort && (!Number.isInteger(Number(devPort)) || Number(devPort) < 1024 || Number(devPort) > 65535)) {
        throw new Error('VITE_DEV_SERVER_PORT 必須是 1024–65535');
    }
    if (isolatedApi && env.VITE_API_TARGET && env.VITE_API_TARGET !== isolatedApi) {
        throw new Error('隔離 dev 服務與 VITE_API_TARGET 不一致，拒絕啟動');
    }
    let revision: string | undefined;
    let dirty = false;
    try {
        revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0;
    } catch {
        // Source archives remain explicitly dev/unknown, never a stale release.
    }
    const displayVersion = buildVersionLabel({
        command, revision, dirty,
        refType: process.env.GITHUB_REF_TYPE,
        refName: process.env.GITHUB_REF_NAME,
    });
    return {
        base: env.VITE_BASE ?? '/',
        // shioaji app upload flattens nested paths — emit a flat bundle.
        // target: old Intel Macs run older WKWebView (Safari 13–15 era);
        // Vite 8's default (baseline-widely-available ≈ Safari 16) emits
        // syntax those webviews cannot parse → white screen on launch (#4)
        build: {
            assetsDir: '',
            target: ['es2020', 'safari13'],
            rolldownOptions: {
                // agent-approval 獨立視窗頁（docs/design/order-confirm-split.md）
                input: {
                    main: path.resolve(__dirname, 'index.html'),
                    approval: path.resolve(__dirname, 'approval.html'),
                },
                output: {
                    codeSplitting: {
                        groups: [
                            {
                                name: 'agent',
                                test: /[\\/]modules[\\/]agent[\\/]/,
                                priority: 4,
                            },
                            {
                                name: 'backtest',
                                test: /[\\/]modules[\\/]backtest[\\/]/,
                                priority: 3,
                            },
                            {
                                name: 'markdown',
                                test: /node_modules[\\/](?:react-markdown|remark-|rehype-|unified|micromark|mdast|hast)/,
                                priority: 2,
                            },
                            {
                                name: 'vendor',
                                test: /node_modules/,
                                priority: 1,
                                maxSize: 400_000,
                            },
                        ],
                    },
                },
            },
        },
        // react-draggable (react-grid-layout dep) reads process.env at runtime
        define: {
            'process.env': {},
            // feature-flag service client key (publishable) — from .env
            // locally, or the STATSIG_CLIENT_KEY secret in CI builds
            __STATSIG_CLIENT_KEY__: JSON.stringify(
                env.STATSIG_CLIENT_KEY ??
                    process.env.STATSIG_CLIENT_KEY ??
                    '',
            ),
            __SHIOAJI_APP_VERSION__: JSON.stringify(pkg.version ?? ''),
            __SHIOAJI_BUILD_VERSION__: JSON.stringify(displayVersion),
            // bundled server version（repo 根目錄 SHIOAJI_VERSION —
            // 與 CI 下載 sidecar 的同一個來源）— app 開機做版本握手
            __SHIOAJI_SERVER_VERSION__: JSON.stringify(
                fs
                    .readFileSync(
                        path.resolve(__dirname, 'SHIOAJI_VERSION'),
                        'utf8',
                    )
                    .trim(),
            ),
        },
        plugins: [vanillaExtractPlugin(), react(), shioajiLocalWatchlistPlugin()],
        test: {
            // The desktop overlay is mirrored here for Tauri dev/CI, but its
            // Rust-adjacent Node tests use node:test rather than Vitest.
            exclude: [
                ...configDefaults.exclude,
                'src-tauri/**',
                'plugins/**/test/*.test.mjs',
            ],
        },
        resolve: {
            alias: {
                '@modules': modulesTarget,
                '@': path.resolve(__dirname, './src'),
            },
        },
        server: {
            // honor a harness-assigned port (preview tooling sets PORT);
            // default stays 5173 for tauri dev. Bind loopback only so Vite
            // is never exposed to the LAN.
            host: '127.0.0.1',
            port: Number(process.env.PORT) || 5173,
            fs: {
                allow: [searchForWorkspaceRoot(process.cwd()), modulesAllowDir],
            },
            proxy: {
                // dev 打自帶 sidecar（scripts/dev-api.sh，與 CI 打包同版
                // binary、port 21322）— 確保 API/UI 版本相符，不依賴使用
                // 者自裝在 8080 的 CLI。要打別台時用 VITE_API_TARGET 蓋掉
                '/api': env.VITE_API_TARGET ?? isolatedApi ?? 'http://127.0.0.1:21322',
            },
        },
    };
});
