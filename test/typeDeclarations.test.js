import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import * as galaxyMapExports from '../src/index.js';
import * as spanshRouteExports from '../src/spanshRoute.js';
import * as readLinesExports from '../examples/spansh-loader/readLines.js';
import * as starClassesExports from '../examples/spansh-loader/starClasses.js';

// The type declarations in types/ are written by hand, so these check they
// still list everything the code has: every export, option, user interface
// setting and command. (`pnpm run typecheck` checks the types themselves.)

const readDeclarations = fileName => readFileSync(new URL(`../types/${fileName}`, import.meta.url), 'utf8');

// Names of the values (not types) a declaration file exports.
function declaredValueNames(declarations) {
  return [...declarations.matchAll(/^export (?:const|function|class) (\w+)/gm)].map(match => match[1]);
}

// Property names in the body of one interface.
function interfaceFieldNames(declarations, interfaceName) {
  const body = new RegExp(`export interface ${interfaceName}[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(declarations)?.[1];
  if (body === undefined) {
    throw new Error(`No interface ${interfaceName} in the declarations`);
  }
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map(match => match[1]);
}

const sorted = names => [...new Set(names)].sort();

describe('type declarations', () => {
  const indexDeclarations = readDeclarations('index.d.ts');
  const spanshRouteDeclarations = readDeclarations('spansh-route.d.ts');

  it('declare every export of the map, and nothing more', () => {
    // index.d.ts re-exports everything in spansh-route.d.ts.
    const declared = [...declaredValueNames(indexDeclarations), ...declaredValueNames(spanshRouteDeclarations)];
    expect(sorted(declared)).toEqual(sorted(Object.keys(galaxyMapExports)));
  });

  it('declare every export of the helper modules', () => {
    expect(sorted(declaredValueNames(spanshRouteDeclarations))).toEqual(sorted(Object.keys(spanshRouteExports)));
    expect(sorted(declaredValueNames(readDeclarations('read-lines.d.ts')))).toEqual(sorted(Object.keys(readLinesExports)));
    expect(sorted(declaredValueNames(readDeclarations('star-classes.d.ts')))).toEqual(sorted(Object.keys(starClassesExports)));
  });

  it('declare every option', () => {
    expect(sorted(interfaceFieldNames(indexDeclarations, 'GalaxyMapOptions'))).toEqual(sorted(Object.keys(galaxyMapExports.DEFAULT_OPTIONS)));
  });

  it('declare every user interface setting', () => {
    expect(sorted(interfaceFieldNames(indexDeclarations, 'UserInterfaceSettings')))
      .toEqual(sorted(Object.keys(galaxyMapExports.DEFAULT_USER_INTERFACE)));
  });

  it('declare every command', () => {
    const declaredTypes = [...indexDeclarations.matchAll(/type: '(\w+)'/g)].map(match => match[1]);
    expect(sorted(declaredTypes)).toEqual(sorted(Object.keys(galaxyMapExports.COMMAND_TYPES)));
  });

  it('are indented two spaces a level', () => {
    const declarationFiles = readdirSync(new URL('../types/', import.meta.url)).filter(fileName => fileName.endsWith('.d.ts'));
    for (const fileName of declarationFiles) {
      let previousIndent = 0;
      readDeclarations(fileName).split('\n').forEach((line, index) => {
        if (line.trim() === '' || line.trim().startsWith('*')) {
          return;
        }
        const indent = line.length - line.trimStart().length;
        expect(indent - previousIndent <= 2 && indent % 2 === 0, `${fileName}:${index + 1} is indented ${indent} spaces after ${previousIndent}`).toBe(true);
        previousIndent = indent;
      });
    }
  });

  it('declare every text key', () => {
    const body = /export type MapTextKey =([\s\S]*?);/.exec(indexDeclarations)[1];
    const declaredKeys = [...body.matchAll(/'(\w+)'/g)].map(match => match[1]);
    expect(sorted(declaredKeys)).toEqual(sorted(Object.keys(galaxyMapExports.DEFAULT_TEXT)));
  });

  it('declare every stop kind of the route legend', () => {
    expect(spanshRouteDeclarations).toContain(`export type RouteStopKind = ${Object.keys(spanshRouteExports.ROUTE_STOP_LABELS).map(kind => `'${kind}'`).join(' | ')};`);
  });
});
