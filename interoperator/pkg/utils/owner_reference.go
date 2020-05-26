package utils

import (
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
)

var log = logf.Log.WithName("utils")

// SetOwnerReference calls controllerutil.SetOwnerReference and
// also adds Interoperator Namespace Label for Filtering watch requests
func SetOwnerReference(owner, object metav1.Object, scheme *runtime.Scheme) error {
	if err := controllerutil.SetOwnerReference(owner, object, scheme); err != nil {
		log.Error(err, "failed setting owner reference for resource", "owner", owner, "resource", object)
		return err
	}
	// Set Interoperator Namespace Label for Filtering watch requests
	setInteroperatorNamespaceLabel(owner, object)
	return nil
}

func setInteroperatorNamespaceLabel(owner, object metav1.Object) {
	if owner == nil || object == nil {
		return
	}
	ownerLabels := owner.GetLabels()
	if ownerLabels == nil {
		return
	}
	ns, ok := ownerLabels[constants.NamespaceLabelKey]
	if !ok {
		return
	}
	objectLabels := object.GetLabels()
	if objectLabels == nil {
		objectLabels = make(map[string]string)
	}
	objectLabels[constants.NamespaceLabelKey] = ns
	object.SetLabels(objectLabels)
	return
}
