package sfservicebindingcleaner

import (
	"context"
	"fmt"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
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

const brokerFinalizer = "broker.servicefabrik.io"

// NOTE: A timeout of 5 seconds has been chosen specifically for the travis
// builds to run successfully.
const timeout = time.Second * 5

var c client.Client

var binding = &osbv1alpha1.SFServiceBinding{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "binding-id",
		Namespace: constants.InteroperatorNamespace,
		Labels: map[string]string{
			"state": "in_queue",
		},
		Finalizers: []string{brokerFinalizer},
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

func setupInteroperatorConfig() {
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
			Namespace: constants.InteroperatorNamespace,
		},
		Data: data,
	}
	Expect(c.Create(context.TODO(), configMap)).NotTo(HaveOccurred())
}

var _ = Describe("SFServiceBindingCleaner controller", func() {
	Context("Orphaned service bindings", func() {
		It("should be deleted", func(done Done) {
			mgr, err := manager.New(cfg, manager.Options{
				MetricsBindAddress: "0",
			})
			Expect(err).NotTo(HaveOccurred())
			c, err = client.New(cfg, client.Options{Scheme: scheme.Scheme})
			Expect(err).NotTo(HaveOccurred())

			controller := &ReconcileSFServiceBindingCleaner{
				Client: mgr.GetClient(),
				Log:    ctrl.Log.WithName("controllers").WithName("SfServiceBindingCleaner"),
				Scheme: mgr.GetScheme(),
			}
			Expect(controller.SetupWithManager(mgr)).NotTo(HaveOccurred())
			stopMgr, mgrStopped := StartTestManager(mgr)
			defer func() {
				close(stopMgr)
				mgrStopped.Wait()
			}()

			err = c.Create(context.TODO(), binding)
			if apierrors.IsInvalid(err) {
				fmt.Fprintln(GinkgoWriter, "Failed to create object due to invalid object error")
				return
			}
			Expect(err).NotTo(HaveOccurred())

			binding := &osbv1alpha1.SFServiceBinding{}
			bindingKey := types.NamespacedName{Name: "binding-id", Namespace: constants.InteroperatorNamespace}
			err = c.Get(context.TODO(), bindingKey, binding)
			Expect(err).NotTo(HaveOccurred())
			Expect(binding.Status.State).Should(Equal("in_queue"))

			err = c.Delete(context.TODO(), binding)
			Expect(err).NotTo(HaveOccurred())
			err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
				binding.SetState("delete")
				err := c.Update(context.TODO(), binding)
				if err != nil {
					// The binding is possibly outdated, fetch it again and
					// retry the update operation.
					_ = c.Get(context.TODO(), bindingKey, binding)
					return err
				}
				return nil
			})

			// Service binding should disappear from the apiserver.
			Eventually(func() error {
				err := c.Get(context.TODO(), bindingKey, binding)
				if err != nil {
					if apierrors.IsNotFound(err) {
						return nil
					}
					return err
				}
				return fmt.Errorf("not deleted")
			}, timeout).Should(Succeed())

			close(done)
		}, float64(timeout))
	})
})
