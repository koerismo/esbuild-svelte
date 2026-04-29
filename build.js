#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import esbuild from 'esbuild';
import ts from 'typescript';

(async () => {
	//start esbuild process
	const bundle = esbuild.build({
		outfile: './dist/index.js',
		entryPoints: ['./index.ts'],
		logLevel: 'info',
		format: 'esm',
		platform: 'node',
		target: 'node16',
	});

	// run .d.ts generation now since it takes a while
	const program = ts.createProgram(['index.ts'], {
		declaration: true,
		emitDeclarationOnly: true,
		outDir: './dist',
	});

	program.emit();
	await bundle;
})();
