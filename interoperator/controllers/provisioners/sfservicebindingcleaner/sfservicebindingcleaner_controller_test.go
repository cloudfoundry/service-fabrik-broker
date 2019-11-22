package controllers

import (
	"context"
	"fmt"
	"testing"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/onsi/gomega"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/util/retry"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/manager"
)

var binding = &osbv1alpha1.SFServiceBinding{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "binding-id",
		Namespace: "default",
		Labels: map[string]string{
			"state": "in_queue",
		},
		Finalizers: []string{constants.BrokerFinalizer},
	},
	Spec: osbv1alpha1.SFServiceBindingSpec{
		ID:                "binding-id",
		InstanceID:        "instance-id",
		PlanID:            "plan-id",
		ServiceID:         "service-id",
		AcceptsIncomplete: true,
	},
	Status: osbv1alpha1.SFServiceBindingStatus{
		State: "in_queue",
	},
}

var c client.Client

const timeout = time.Second * 2

func setupInteroperatorConfig(g *gomega.GomegaWithT) {
	data := make(map[string]string)
	data["instanceWorkerCount"] = "1"
	data["bindingWorkerCount"] = "1"
	watchList := `
- apiVersion: kubedb.com/v1alpha1
  kind: Postgres
- apiVersion: kubernetes.sapcloud.io/v1alpha1
  kind: Postgresql
- apiVersion: deployment.servicefabrik.io/v1alpha1
  kind: Director`
	data["instanceContollerWatchList"] = watchList
	data["bindingContollerWatchList"] = watchList
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      constants.ConfigMapName,
			Namespace: constants.DefaultServiceFabrikNamespace,
		},
		Data: data,
	}
	g.Expect(c.Create(context.TODO(), configMap)).NotTo(gomega.HaveOccurred())
}

func TestReconcile(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	mgr, err := manager.New(cfg, manager.Options{
		MetricsBindAddress: "0",
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c, err = client.New(cfg, client.Options{Scheme: scheme.Scheme})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	setupInteroperatorConfig(g)
	controller := &SfServiceBindingCleanerReconciler{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("controllers").WithName("SfServiceBindingCleaner"),
		Scheme: mgr.GetScheme(),
	}
	g.Expect(controller.SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())
	stopMgr, mgrStopped := StartTestManager(mgr, g)
	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()

	err = c.Create(context.TODO(), binding)
	if apierrors.IsInvalid(err) {
		t.Logf("failed to create object, got an invalid object error: %v", err)
		return
	}
	g.Expect(err).NotTo(gomega.HaveOccurred())

	binding := &osbv1alpha1.SFServiceBinding{}
	bindingKey := types.NamespacedName{Name: "binding-id", Namespace: "default"}
	g.Eventually(func() error {
		return c.Get(context.TODO(), bindingKey, binding)
	}, timeout).Should(gomega.Succeed())
	g.Expect(binding.Status.State).Should(gomega.Equal("in_queue"))

	g.Expect(c.Delete(context.TODO(), binding)).NotTo(gomega.HaveOccurred())
	err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
		err = c.Get(context.TODO(), bindingKey, binding)
		if err != nil {
			return err
		}
		binding.SetState("delete")
		return c.Update(context.TODO(), binding)
	})

	// Service binding should disappear from the apiserver.
	g.Eventually(func() error {
		err := c.Get(context.TODO(), bindingKey, binding)
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil
			}
			return err
		}
		return fmt.Errorf("not deleted")
	}, timeout).Should(gomega.Succeed())
}
