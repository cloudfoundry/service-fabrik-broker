'use strict'

const _ = require('lodash');
const fs = require('fs');

const packagePath = process.argv[2];
const rootPackagePath = process.argv[3];
const destPackagePath = process.argv[4];

if(_.isEmpty(packagePath) || _.isEmpty(rootPackagePath) || _.isEmpty(destPackagePath)) {
  console.log("usage: ./collect-all-dependecies <path-to-mod-package-json> <path-to-root-package-json> <path-to-output-package-json>");
  return;
}

let packageSpec = JSON.parse(fs.readFileSync(packagePath));
let rootPackageSpec = JSON.parse(fs.readFileSync(rootPackagePath));

let packageDeps = packageSpec.dependencies;
let rootDeps = rootPackageSpec.dependencies;

let visited = {};

function isSFMod(name) {
  if(_.startsWith(name, '@sf')) {
    return true;
  }
  return false;
}

function getDepsFromPackage(packagePath) {
  return JSON.parse(fs.readFileSync(packagePath)).dependencies;
}

function collectAllDeps(modDeps, rootDeps, pathStr) {
  let deps = {};
  for(let dep in modDeps) {
    if(isSFMod(dep)) {
      if(_.has(visited, dep)) {
        console.log(`${pathStr},${dep}`);
        continue;
      } 
      visited[dep] = 'visited';
      let packagePath = './' + _.split(rootDeps[dep], 'file:')[1] + '/package.json';
      let currentModDeps = getDepsFromPackage(packagePath);
      let tempDeps = collectAllDeps(currentModDeps, rootDeps, `${pathStr},${dep}`);
      if(!_.isEmpty(tempDeps)) {
        //remove duplicates from deps and tempDeps and merge
        for (let childModDep in tempDeps) {
          if(_.has(deps, childModDep)) {
            if (deps[childModDep] != tempDeps[childModDep]) {
              console.log(` Error: inconsistent versioning: ${childModDep} is present as ${deps[childModDep]} and ${tempDeps[childModDep]}`);
              return {};
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
          return {};
        }
      } else {
        deps[dep] = modDeps[dep];
      }
    }
  }
  return deps;
}

let deps = collectAllDeps(packageDeps, rootDeps);
packageSpec.dependencies = deps;
const jsonData = JSON.stringify(packageSpec, null, 2);
fs.writeFileSync(destPackagePath, jsonData);