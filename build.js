#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import esbuild from 'esbuild';
import ts from 'typescript';

const esbuildCommon = {
	entryPoints: ['./index.ts'],
	platform: 'node',
	target: ['node18.12.0'],
};

(async () => {

	//start esbuild process
	const bundle = esbuild.build({
		logLevel: 'info',
		format: 'esm',
		outfile: './dist/index.js',
        platform: 'node',
        target: 'node16',
		...esbuildCommon,
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
