// vite.config.ts 构建时注入：音素模型文件指纹（sha256 前 12 位，没有模型时为 none）
declare const __MODEL_REV__: string
