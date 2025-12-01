const esbuild = require('esbuild');
const alias = require('esbuild-plugin-alias');
const path = require('path');

esbuild.build({
    entryPoints: ['./src/**/*.ts'], // 项目入口文件
    outdir: './dist', // 输出目录
    target: ['node20'],
    platform: 'node',
    format: 'cjs', // 输出为 ESM 格式
    sourcemap: false, // 生成 source map
    bundle: true, // 不打包，保持独立文件
    outbase: 'src', // 保留 src 目录结构
    tsconfig: './tsconfig.json', // 使用 TypeScript 配置
    plugins: [
    alias({
        '@utils': path.resolve(__dirname, './src/utils'),
        '@constants': path.resolve(__dirname, './src/constants'),
        }),
    ],
}).catch((e) => {
    console.log(e)    
    process.exit(1)}
);