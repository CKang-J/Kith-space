import type { RuntimeId } from "../../local-runtime/runtimeCatalog.js";
import type { RuntimeConfigCompiler } from "./runtimeConfigCompiler.js";
import {
  ClaudeRuntimeConfigCompiler, CodexRuntimeConfigCompiler, OpenCodeRuntimeConfigCompiler,
  PiRuntimeConfigCompiler, PiBuiltinRuntimeConfigCompiler,
} from "./runtimeCompilers.js";

export class RuntimeConfigCompilerRegistry {
  private readonly compilers = new Map<RuntimeId, RuntimeConfigCompiler>();

  constructor(compilers: readonly RuntimeConfigCompiler[] = [
    new ClaudeRuntimeConfigCompiler(), new CodexRuntimeConfigCompiler(),
    new OpenCodeRuntimeConfigCompiler(), new PiRuntimeConfigCompiler(),
    new PiBuiltinRuntimeConfigCompiler(),
  ]) {
    for (const compiler of compilers) {
      if (this.compilers.has(compiler.runtimeId)) throw new Error(`duplicate runtime compiler: ${compiler.runtimeId}`);
      this.compilers.set(compiler.runtimeId, compiler);
    }
  }

  get(runtimeId: RuntimeId): RuntimeConfigCompiler {
    const compiler = this.compilers.get(runtimeId);
    if (!compiler) throw new Error(`runtime compiler unavailable: ${runtimeId}`);
    return compiler;
  }

  list(): RuntimeConfigCompiler[] { return [...this.compilers.values()]; }
}

export const runtimeConfigCompilerRegistry = new RuntimeConfigCompilerRegistry();
