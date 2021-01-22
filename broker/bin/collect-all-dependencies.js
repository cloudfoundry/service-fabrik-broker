'use strict';

const _ = require('lodash');
const fs = require('fs');
const parsers = require('@yarnpkg/parsers');
const { exit } = require('process');

const packagePath = process.argv[2];
const yarnLockPath = process.argv[3];
const destPackagePath = process.argv[4];

if(_.isEmpty(packagePath) || _.isEmpty(yarnLockPath) || _.isEmpty(destPackagePath)) {
  console.log('usage: ./collect-all-dependecies <package-path> <path-to-yarn-lock> <path-to-output-package-json>');
  return;
}

let packageSpec = JSON.parse(fs.readFileSync(packagePath));
let lockFileJson = parsers.parseSyml(fs.readFileSync(yarnLockPath, 'utf8'));
let depNames = _.keys(lockFileJson);

let visited = {};

function isSFMod(name) {
  if(_.startsWith(name, '@sf')) {
    return true;
  }
  return false;
}

function getDepsFromLockfile(packageName) {
  let packageKeyName = _.find(depNames, name => _.startsWith(name, packageName));
  if(!packageKeyName) {
    exit(1);
  }
  return lockFileJson[packageKeyName].dependencies;
}

function collectAllDeps(modDeps) {
  let deps = {};
  for(let dep in modDeps) {
    if(isSFMod(dep)) {
      if(_.has(visited, dep)) {
        continue;
      } 
      visited[dep] = 'visited';
      let currentModDeps = getDepsFromLockfile(dep);
      let tempDeps = collectAllDeps(currentModDeps);
      if(!_.isEmpty(tempDeps)) {
        // remove duplicates from deps and tempDeps and merge
        for (let childModDep in tempDeps) {
          if(_.has(deps, childModDep)) {
            if (deps[childModDep] != tempDeps[childModDep]) {
              console.log(` Error: inconsistent versioning: ${childModDep} is present as ${deps[childModDep]} and ${tempDeps[childModDep]}`);
              exit(1);
            }
          } else {
            deps[childModDep] = tempDeps[childModDep];
          }
        }
      }
    } else {
      if(_.has(deps, dep)) {
        if (deps[dep] != modDeps[dep]) {
          console.log(` Error: inconsistent versioning: ${dep} is present as ${deps[dep]} and ${modDeps[dep]}`);
          exit(1);
        }
      } else {
        deps[dep] = modDeps[dep];
      }
    }
  }
  return deps;
}

let deps = collectAllDeps(packageSpec.dependencies);

packageSpec.dependencies = deps;
const jsonData = JSON.stringify(packageSpec, null, 2);
fs.writeFileSync(destPackagePath, jsonData);
