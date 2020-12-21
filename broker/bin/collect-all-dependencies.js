'use strict'

const _ = require('lodash');
const fs = require('fs');

const osbBrokerDeps = JSON.parse(fs.readFileSync('/Users/i350504/sources/other_info/yarn/service-fabrik-broker/broker/applications/osb-broker/package.json')).dependencies;
const rootDeps = JSON.parse(fs.readFileSync('/Users/i350504/sources/other_info/yarn/service-fabrik-broker/broker/package.json')).dependencies;
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

function collectAllDeps(modDeps, rootDeps) {
  let deps = {};
  for(let dep in modDeps) {
    if(isSFMod(dep)) {
      if(_.has(visited, dep)) continue; 
      visited[dep] = 'visited';
      let packagePath = _.split(rootDeps[dep], 'file:')[1] + '/package.json';
      let currentModDeps = getDepsFromPackage(packagePath);
      let tempDeps = collectAllDeps(currentModDeps, rootDeps);
      console.log(dep);
      console.log(tempDeps);
      console.log("---------------------------------------------");
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

let deps = collectAllDeps(osbBrokerDeps, rootDeps);
console.log(deps);