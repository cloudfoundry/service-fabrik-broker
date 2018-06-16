const api = require('./ApiServerEventMesh');
const apiserver = new api();

const annotation_guid = "1111"
const resource_guid = "resg1"

// apiserver.createResource('director', resource_guid, {
//     "speckey": 12
//   })
//   .then(status => console.log('create resource', status))
//   .catch(e => console.log('create resource ', e))
//   .then(() =>
//     apiserver.updateResourceState('director', resource_guid, "inp")
//     .then(status => console.log('update resource state', status))
//     .catch(e => console.log('update resouce state', e))
//   )
//   .then(() =>

//     apiserver.getResourceState('director', resource_guid, "inp")
//     .then(status => console.log('get resource state:', status))
//     .catch(e => console.log('get resource state:', e))

//   )
//   .then(() =>
//     apiserver.annotateResource({
//       resourceId: resource_guid,
//       annotationId: annotation_guid,
//       annotationType: "defaultbackup",
//       annotationName: "backup",
//       val: {
//         "a": "a",
//         "status": "inp"
//       }
//     })
//     .then(status => console.log('annotate resource', status))
//     .catch(e => console.log('annotate resource', e))

//   )
//   .then(() =>
//     apiserver.registerWatcher("deployment", "directors", val => console.log(val))
//     .then(status => console.log(`watcher reistered`, status.body.metadata))
//     .catch(e => console.log('Error in watcher', e))
//   )
//   .then(() =>
apiserver.registerWatcher("backup", "defaultbackup", val => console.log(val))
  .then(status => console.log(`watcher reistered`, status.body.metadata))
  .catch(e => console.log('Error in watcher', e))
// )
// .then(() =>
//   apiserver.updateLastAnnotation({
//     resourceId: resource_guid,
//     annotationType: "defaultbackup",
//     annotationName: "backup",
//     value: "new_guid"
//   })
//   .then(status => console.log(`update last annotation`, status.body.metadata))
//   .catch(e => console.log('update last annotation', e))
// )
// .then(() =>
//   apiserver.getLastAnnotation({
//     resourceId: resource_guid,
//     annotationType: "defaultbackup",
//     annotationName: "backup",
//   })
//   .then(status => console.log(`get last annotation:`, status))
//   .catch(e => console.log('get last annotation', e))
// )
// .then(() =>
//   apiserver.updateAnnotationResult({
//     resourceId: resource_guid,
//     annotationId: annotation_guid,
//     annotationType: "defaultbackup",
//     annotationName: "backup",
//     value: {
//       "inp23": "a"
//     }
//   })
//   .then(status => console.log('update annotation Result ', status))
//   .catch(e => console.log('update annotation Result ', e))


// )
// .then(() =>
//   apiserver.updateAnnotationState({
//     resourceId: resource_guid,
//     annotationId: annotation_guid,
//     annotationType: "defaultbackup",
//     annotationName: "backup",
//     stateValue: "murali12"
//   })
//   .then(status => console.log('update annotation state', status))
//   .catch(e => console.log('update annotation state', e))

// )
// .then(() =>
//   apiserver.getAnnotationOptions({
//     resourceId: resource_guid,
//     annotationId: annotation_guid,
//     annotationType: "defaultbackup",
//     annotationName: "backup",
//   })
//   .then(status => console.log('get annotation options', status))
//   .catch(e => console.log('get annotation options', e))

// )
// .then(() =>
//   apiserver.getAnnotationState({
//     resourceId: resource_guid,
//     annotationId: annotation_guid,
//     annotationType: "defaultbackup",
//     annotationName: "backup",
//   })
//   .then(status => console.log('get annotation state', status))
//   .catch(e => console.log('get annotation state', e))
// )