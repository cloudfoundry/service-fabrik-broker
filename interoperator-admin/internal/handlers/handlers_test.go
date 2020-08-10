package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/onsi/gomega"
	"k8s.io/client-go/rest"
)

func TestNewAdminHandler(t *testing.T) {
	type args struct {
		kubeConfig *rest.Config
	}
	tests := []struct {
		name    string
		args    args
		want    bool
		wantErr bool
	}{
		{
			name:    "fail if kubeConfig is not passed",
			args:    args{},
			want:    false,
			wantErr: true,
		},
		{
			name: "return AdminHandler",
			args: args{
				kubeConfig: kubeConfig,
			},
			want:    true,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NewAdminHandler(tt.args.kubeConfig)
			if (err != nil) != tt.wantErr {
				t.Errorf("NewAdminHandler() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.want == true && got.kubeconfig != tt.args.kubeConfig {
				t.Errorf("NewAdminHandler() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_handler_GetDeployment(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	type args struct {
		kubeConfig *rest.Config
		instanceID string
	}
	tests := []struct {
		name    string
		args    args
		want    bool
		wantErr bool
		setup   func(*args)
		cleanup func(*args)
	}{
		{
			name: "return deployment if exists on Cluster",
			args: args{
				kubeConfig: kubeConfig,
				instanceID: "instance-id",
			},
			want:    true,
			wantErr: false,
			setup: func(args *args) {
				g.Expect(createTestSFServiceInstance(args.instanceID, c)).NotTo(gomega.HaveOccurred())
			},
			cleanup: func(args *args) {
				g.Expect(deleteTestSFServiceInstance(args.instanceID, c)).NotTo(gomega.HaveOccurred())
			},
		},
		{
			name: "return error if deployment does not exist on Cluster",
			args: args{
				kubeConfig: kubeConfig,
			},
			want:    false,
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup(&tt.args)
			}
			if tt.cleanup != nil {
				defer tt.cleanup(&tt.args)
			}
			h, _ := NewAdminHandler(tt.args.kubeConfig)
			router := mux.NewRouter()
			router.HandleFunc("/admin/deployments/{deploymentID}", h.GetDeployment).Methods("GET")
			req, err := http.NewRequest("GET", "/admin/deployments/"+tt.args.instanceID, nil)
			if err != nil {
				t.Fatal(err)
			}
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)
			if tt.want {
				if status := rr.Code; status != http.StatusOK {
					t.Errorf("handler returned wrong status code: got %v want %v",
						status, http.StatusOK)
				}
				deploymentResp := deploymentInfo{}
				deploymentResp.DeploymentStatus = &deploymentStatus{}
				json.Unmarshal(rr.Body.Bytes(), &deploymentResp)
				instance := &osbv1alpha1.SFServiceInstance{}
				key := types.NamespacedName{
					Name:      tt.args.instanceID,
					Namespace: "sf-" + tt.args.instanceID,
				}
				g.Expect(c.Get(context.TODO(), key, instance)).NotTo(gomega.HaveOccurred())
				if validateDeploymentResponseFields(&deploymentResp, instance) == false {
					t.Errorf("handler returned wrong deployment response: got %v want %v",
						deploymentResp, *instance)
				}
			}
			if tt.wantErr {
				if status := rr.Code; status == http.StatusOK {
					t.Errorf("Expected error code: got %v ", status)
				}
			}
		})
	}
}

func Test_handler_GetDeploymentsSummary(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	type args struct {
		kubeConfig       *rest.Config
		totalDeployments int
		deploymentIDs    []string
	}
	tests := []struct {
		name    string
		args    args
		want    bool
		wantErr bool
		setup   func(*args)
		cleanup func(*args)
	}{
		{
			name: "return deployment summary if exists on Cluster",
			args: args{
				kubeConfig:       kubeConfig,
				totalDeployments: 2,
				deploymentIDs:    []string{"instance-id-1", "instance-id-2"},
			},
			want:    true,
			wantErr: false,
			setup: func(args *args) {
				for i := 0; i < args.totalDeployments; i++ {
					g.Expect(createTestSFServiceInstance(args.deploymentIDs[i], c)).NotTo(gomega.HaveOccurred())
				}
			},
			cleanup: func(args *args) {
				for i := 0; i < args.totalDeployments; i++ {
					g.Expect(deleteTestSFServiceInstance(args.deploymentIDs[i], c)).NotTo(gomega.HaveOccurred())
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup(&tt.args)
			}
			if tt.cleanup != nil {
				defer tt.cleanup(&tt.args)
			}
			h, _ := NewAdminHandler(tt.args.kubeConfig)
			router := mux.NewRouter()
			router.HandleFunc("/admin/deployments/", h.GetDeploymentsSummary).Methods("GET")
			req, err := http.NewRequest("GET", "/admin/deployments/", nil)
			if err != nil {
				t.Fatal(err)
			}
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)
			if tt.want {
				if status := rr.Code; status != http.StatusOK {
					t.Errorf("handler returned wrong status code: got %v want %v",
						status, http.StatusOK)
				}
				deploymentsSummaryResp := deploymentsSummaryResponse{}
				json.Unmarshal(rr.Body.Bytes(), &deploymentsSummaryResp)
				if deploymentsSummaryResp.TotalDeployments != tt.args.totalDeployments {
					t.Errorf("handler returned wrong deployment summary response. Total Deployments: got %v want %v",
						deploymentsSummaryResp.TotalDeployments, tt.args.totalDeployments)
				}
				for i := 0; i < tt.args.totalDeployments; i++ {
					instance := &osbv1alpha1.SFServiceInstance{}
					key := types.NamespacedName{
						Name:      tt.args.deploymentIDs[i],
						Namespace: "sf-" + tt.args.deploymentIDs[i],
					}
					g.Expect(c.Get(context.TODO(), key, instance)).NotTo(gomega.HaveOccurred())
					if validateDeploymentResponseFields(&deploymentsSummaryResp.Deployments[i], instance) == false {
						t.Errorf("handler returned wrong deployment response: got %v want %v",
							deploymentsSummaryResp.Deployments[0], *instance)
					}
				}
			}
			if tt.wantErr {
				if status := rr.Code; status == http.StatusOK {
					t.Errorf("Expected error code: got %v ", status)
				}
			}
		})
	}
}

func Test_handler_UpdateDeployment(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	type args struct {
		kubeConfig *rest.Config
		instanceID string
	}
	tests := []struct {
		name    string
		args    args
		want    bool
		wantErr bool
		setup   func(*args)
		cleanup func(*args)
	}{
		{
			name: "update deployment if exists on Cluster",
			args: args{
				kubeConfig: kubeConfig,
				instanceID: "instance-id",
			},
			want:    true,
			wantErr: false,
			setup: func(args *args) {
				g.Expect(createTestSFServiceInstance(args.instanceID, c)).NotTo(gomega.HaveOccurred())
			},
			cleanup: func(args *args) {
				g.Expect(deleteTestSFServiceInstance(args.instanceID, c)).NotTo(gomega.HaveOccurred())
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup(&tt.args)
			}
			if tt.cleanup != nil {
				defer tt.cleanup(&tt.args)
			}
			h, _ := NewAdminHandler(tt.args.kubeConfig)
			router := mux.NewRouter()
			router.HandleFunc("/admin/deployments/{deploymentID}", h.UpdateDeployment).Methods("PATCH")
			req, err := http.NewRequest("PATCH", "/admin/deployments/"+tt.args.instanceID, nil)
			if err != nil {
				t.Fatal(err)
			}
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)
			if tt.want {
				if status := rr.Code; status != http.StatusOK {
					t.Errorf("handler returned wrong status code: got %v want %v",
						status, http.StatusOK)
				}
				instance := &osbv1alpha1.SFServiceInstance{}
				key := types.NamespacedName{
					Name:      tt.args.instanceID,
					Namespace: "sf-" + tt.args.instanceID,
				}
				g.Expect(c.Get(context.TODO(), key, instance)).NotTo(gomega.HaveOccurred())
				if instance.GetState() != "update" {
					t.Errorf("Expected state update got %v ", instance.GetState())
				}
			}
			if tt.wantErr {
				if status := rr.Code; status == http.StatusOK {
					t.Errorf("Expected error code: got %v ", status)
				}
			}
		})
	}
}

/* utility functions */
func validateDeploymentResponseFields(deploymentResp *deploymentInfo, instance *osbv1alpha1.SFServiceInstance) bool {
	if deploymentResp.DeploymentID != instance.GetName() {
		return false
	}
	if deploymentResp.ServiceID != instance.Spec.ServiceID {
		return false
	}
	if deploymentResp.PlanID != instance.Spec.PlanID {
		return false
	}
	if deploymentResp.ClusterID != instance.Spec.ClusterID {
		return false
	}
	return true
}

func createTestSFServiceInstance(instanceID string, c client.Client) error {
	instance := &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name:      instanceID,
			Namespace: "sf-" + instanceID,
			Labels: map[string]string{
				"state": "succeeded",
			},
		},
		Spec: osbv1alpha1.SFServiceInstanceSpec{
			ServiceID:        "service-id",
			PlanID:           "plan-id",
			RawContext:       nil,
			OrganizationGUID: "organization-guid",
			SpaceGUID:        "space-guid",
			RawParameters:    nil,
			PreviousValues:   nil,
			ClusterID:        "1",
		},
		Status: osbv1alpha1.SFServiceInstanceStatus{
			State:       "succeeded",
			Description: "Deployment succeeded",
		},
	}
	return c.Create(context.TODO(), instance)
}

func deleteTestSFServiceInstance(instanceID string, c client.Client) error {
	instance := &osbv1alpha1.SFServiceInstance{}
	key := types.NamespacedName{
		Name:      instanceID,
		Namespace: "sf-" + instanceID,
	}
	err := c.Get(context.TODO(), key, instance)
	if err != nil {
		return err
	}
	return c.Delete(context.TODO(), instance)
}
