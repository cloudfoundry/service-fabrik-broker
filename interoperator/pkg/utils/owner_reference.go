package utils

import (
	"fmt"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client/apiutil"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
)

var log = logf.Log.WithName("utils")

// SetOwnerReference is almost as same as controllerutil.SetControllerReference
// This implementation does set Controller field and BlockOwnerDeletion as false
// It also adds Interoperator Namespace Label for Filtering watch requests
func SetOwnerReference(owner, object metav1.Object, scheme *runtime.Scheme) error {
	if err := setOwnerReference(owner, object, scheme); err != nil {
		log.Error(err, "failed setting owner reference for resource", "owner", owner, "resource", object)
		return err
	}
	// Set Interoperator Namespace Label for Filtering watch requests
	setInteroperatorNamespaceLabel(owner, object)
	return nil
}

// setOwnerReference is almost as same as controllerutil.SetControllerReference
// This implementation does set Controller field and BlockOwnerDeletion as false
func setOwnerReference(owner, object metav1.Object, scheme *runtime.Scheme) error {
	ro, ok := owner.(runtime.Object)
	if !ok {
		return fmt.Errorf("%T is not a runtime.Object, cannot call setOwnerReference", owner)
	}

	ownerNs := owner.GetNamespace()
	if ownerNs != "" {
		objNs := object.GetNamespace()
		if objNs == "" {
			return fmt.Errorf("cluster-scoped resource must not have a namespace-scoped owner, owner's namespace %s", ownerNs)
		}
		if ownerNs != objNs {
			return fmt.Errorf("cross-namespace owner references are disallowed, owner's namespace %s, obj's namespace %s", owner.GetNamespace(), object.GetNamespace())
		}
	}

	gvk, err := apiutil.GVKForObject(ro, scheme)
	if err != nil {
		return err
	}

	// Create a new ref
	blockOwnerDeletion := false
	isController := false
	ref := metav1.OwnerReference{
		APIVersion:         gvk.GroupVersion().String(),
		Kind:               gvk.Kind,
		Name:               owner.GetName(),
		UID:                owner.GetUID(),
		BlockOwnerDeletion: &blockOwnerDeletion,
		Controller:         &isController,
	}

	existingRefs := object.GetOwnerReferences()
	fi := -1
	for i, r := range existingRefs {
		if referSameObject(ref, r) {
			fi = i
		}
	}
	if fi == -1 {
		existingRefs = append(existingRefs, ref)
	} else {
		existingRefs[fi] = ref
	}

	// Update owner references
	object.SetOwnerReferences(existingRefs)
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

// Returns true if a and b point to the same object
func referSameObject(a, b metav1.OwnerReference) bool {
	aGV, err := schema.ParseGroupVersion(a.APIVersion)
	if err != nil {
		return false
	}

	bGV, err := schema.ParseGroupVersion(b.APIVersion)
	if err != nil {
		return false
	}

	return aGV == bGV && a.Kind == b.Kind && a.Name == b.Name
}
