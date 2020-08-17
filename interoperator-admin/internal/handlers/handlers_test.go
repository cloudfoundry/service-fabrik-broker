package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/constants"
	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/onsi/gomega"
	"k8s.io/client-go/rest"
)

type queryArgs struct {
	serviceQuery         string
	planQuery            string
	exepectedDeployments int
}
type testArgs struct {
	kubeConfig       *rest.Config
	totalDeployments int
	deploymentIDs    []string
	serviceIDs       []string
	planIDs          []string
	queryArgs        *queryArgs
}

func TestNewAdminHandler(t *testing.T) {
	tests := []struct {
		name    string
		args    testArgs
		want    bool
		wantErr bool
	}{
		{
			name:    "fail if kubeConfig is not passed",
			args:    testArgs{},
			want:    false,
			wantErr: true,
		},
		{
			name: "return AdminHandler",
			args: testArgs{
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
				t.Errorf("NewAdminHandler() error got= %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.want == true && got.kubeconfig != tt.args.kubeConfig {
				t.Errorf("NewAdminHandler() got %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_handler_GetDeployment(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	tests := []struct {
		name    string
		args    testArgs
		want    bool
		wantErr bool
		setup   func(*testArgs)
		cleanup func(*testArgs)
	}{
		{
			name: "return deployment if exists on Cluster",
			args: testArgs{
				kubeConfig:       kubeConfig,
				totalDeployments: 1,
				deploymentIDs:    []string{"instance-id"},
				serviceIDs:       []string{"service-id"},
				planIDs:          []string{"plan-id"},
			},
			want:    true,
			wantErr: false,
			setup: func(args *testArgs) {
				g.Expect(deployTestResources(c, args)).NotTo(gomega.HaveOccurred())
			},
			cleanup: func(args *testArgs) {
				g.Expect(cleanupTestResources(c, args)).NotTo(gomega.HaveOccurred())
			},
		},
		{
			name: "return error if deployment does not exist on Cluster",
			args: testArgs{
				kubeConfig:       kubeConfig,
				totalDeployments: 1,
				deploymentIDs:    []string{"instance-id"},
				serviceIDs:       []string{"service-id"},
				planIDs:          []string{"plan-id"},
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
			req, err := http.NewRequest("GET", "/admin/deployments/"+tt.args.deploymentIDs[0], nil)
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
					Name:      tt.args.deploymentIDs[0],
					Namespace: "sf-" + tt.args.deploymentIDs[0],
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

func Test_handler_GetDeploymentsSummaryNoQuery(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	tests := []struct {
		name    string
		args    testArgs
		want    bool
		wantErr bool
		setup   func(*testArgs)
		cleanup func(*testArgs)
	}{
		{
			name: "return deployment summary for instances on Cluster",
			args: testArgs{
				kubeConfig:       kubeConfig,
				totalDeployments: 2,
				deploymentIDs:    []string{"instance-id-1", "instance-id-2"},
				serviceIDs:       []string{"service-id-1", "service-id-2"},
				planIDs:          []string{"plan-id-1", "plan-id-2"},
			},
			want:    true,
			wantErr: false,
			setup: func(args *testArgs) {
				g.Expect(deployTestResources(c, args)).NotTo(gomega.HaveOccurred())
			},
			cleanup: func(args *testArgs) {
				g.Expect(cleanupTestResources(c, args)).NotTo(gomega.HaveOccurred())
			},
		},
		{
			name: "return deployment summary for instances on Cluster",
			args: testArgs{
				kubeConfig:       kubeConfig,
				totalDeployments: 2,
				deploymentIDs:    []string{"instance-id-1", "instance-id-2"},
				serviceIDs:       []string{"service-id-1", "service-id-2"},
				planIDs:          []string{"plan-id-1", "plan-id-2"},
			},
			want:    true,
			wantErr: false,
			setup: func(args *testArgs) {
				g.Expect(deployTestResources(c, args)).NotTo(gomega.HaveOccurred())
			},
			cleanup: func(args *testArgs) {
				g.Expect(cleanupTestResources(c, args)).NotTo(gomega.HaveOccurred())
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

func Test_handler_GetDeploymentsSummaryQuery(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	tests := []struct {
		name    string
		args    testArgs
		want    bool
		wantErr bool
		setup   func(*testArgs)
		cleanup func(*testArgs)
	}{
		{
			name: "return deployment summary based on query params",
			args: testArgs{
				kubeConfig:       kubeConfig,
				totalDeployments: 2,
				deploymentIDs:    []string{"instance-id-1", "instance-id-2"},
				serviceIDs:       []string{"service-id-1", "service-id-2"},
				planIDs:          []string{"plan-id-1", "plan-id-2"},
				queryArgs: &queryArgs{
					serviceQuery:         "service-id-1",
					exepectedDeployments: 1,
				},
			},
			want:    true,
			wantErr: false,
			setup: func(args *testArgs) {
				g.Expect(deployTestResources(c, args)).NotTo(gomega.HaveOccurred())
			},
			cleanup: func(args *testArgs) {
				g.Expect(cleanupTestResources(c, args)).NotTo(gomega.HaveOccurred())
			},
		},
		{
			name: "returns empty response when no match deployment exists",
			args: testArgs{
				kubeConfig:       kubeConfig,
				totalDeployments: 2,
				deploymentIDs:    []string{"instance-id-1", "instance-id-2"},
				serviceIDs:       []string{"service-id-1", "service-id-2"},
				planIDs:          []string{"plan-id-1", "plan-id-2"},
				queryArgs: &queryArgs{
					serviceQuery:         "service-id-3",
					exepectedDeployments: 0,
				},
			},
			want:    true,
			wantErr: false,
			setup: func(args *testArgs) {
				g.Expect(deployTestResources(c, args)).NotTo(gomega.HaveOccurred())
			},
			cleanup: func(args *testArgs) {
				g.Expect(cleanupTestResources(c, args)).NotTo(gomega.HaveOccurred())
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
			q := req.URL.Query()
			if tt.args.queryArgs.serviceQuery != "" {
				q.Add("service", tt.args.queryArgs.serviceQuery)
			}
			if tt.args.queryArgs.planQuery != "" {
				q.Add("plan", tt.args.queryArgs.planQuery)
			}
			req.URL.RawQuery = q.Encode()
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)
			if tt.want {
				if status := rr.Code; status != http.StatusOK {
					t.Errorf("handler returned wrong status code: got %v want %v",
						status, http.StatusOK)
				}
				deploymentsSummaryResp := deploymentsSummaryResponse{}
				json.Unmarshal(rr.Body.Bytes(), &deploymentsSummaryResp)
				if deploymentsSummaryResp.TotalDeployments != tt.args.queryArgs.exepectedDeployments {
					t.Errorf("handler returned wrong deployment summary response. Total Deployments: got %v want %v",
						deploymentsSummaryResp.TotalDeployments, tt.args.queryArgs.exepectedDeployments)
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
	tests := []struct {
		name    string
		args    testArgs
		want    bool
		wantErr bool
		setup   func(*testArgs)
		cleanup func(*testArgs)
	}{
		{
			name: "update deployment if exists on Cluster",
			args: testArgs{
				kubeConfig:       kubeConfig,
				totalDeployments: 1,
				deploymentIDs:    []string{"instance-id"},
				serviceIDs:       []string{"service-id"},
				planIDs:          []string{"plan-id"},
			},
			want:    true,
			wantErr: false,
			setup: func(args *testArgs) {
				g.Expect(deployTestResources(c, args)).NotTo(gomega.HaveOccurred())
			},
			cleanup: func(args *testArgs) {
				g.Expect(cleanupTestResources(c, args)).NotTo(gomega.HaveOccurred())
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
			req, err := http.NewRequest("PATCH", "/admin/deployments/"+tt.args.deploymentIDs[0], nil)
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
					Name:      tt.args.deploymentIDs[0],
					Namespace: "sf-" + tt.args.deploymentIDs[0],
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

func Test_handler_UpdateDeploymentsInBatch(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	tests := []struct {
		name    string
		args    testArgs
		want    bool
		wantErr bool
		setup   func(*testArgs)
		cleanup func(*testArgs)
	}{
		{
			name: "trigger updates of all deployments in cluster when filter is not specified",
			args: testArgs{
				kubeConfig:       kubeConfig,
				totalDeployments: 2,
				deploymentIDs:    []string{"instance-id-1", "instance-id-2"},
				serviceIDs:       []string{"service-id-1", "service-id-2"},
				planIDs:          []string{"plan-id-1", "plan-id-2"},
			},
			want:    true,
			wantErr: false,
			setup: func(args *testArgs) {
				g.Expect(deployTestResources(c, args)).NotTo(gomega.HaveOccurred())
			},
			cleanup: func(args *testArgs) {
				g.Expect(cleanupTestResources(c, args)).NotTo(gomega.HaveOccurred())
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
			router.HandleFunc("/admin/deployments/", h.UpdateDeploymentsInBatch).Methods("PATCH")
			req, err := http.NewRequest("PATCH", "/admin/deployments/", nil)
			if err != nil {
				t.Fatal(err)
			}
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)
			time.Sleep(time.Duration(tt.args.totalDeployments*constants.DelayBetweenBatchUpdates) * time.Second)
			if tt.want {
				if status := rr.Code; status != http.StatusOK {
					t.Errorf("handler returned wrong status code: got %v want %v",
						status, http.StatusOK)
				}
				for i := 0; i < tt.args.totalDeployments; i++ {
					instance := &osbv1alpha1.SFServiceInstance{}
					key := types.NamespacedName{
						Name:      tt.args.deploymentIDs[i],
						Namespace: "sf-" + tt.args.deploymentIDs[i],
					}
					g.Expect(c.Get(context.TODO(), key, instance)).NotTo(gomega.HaveOccurred())
					if instance.GetState() != "update" {
						t.Errorf("Expected state update got %v ", instance.GetState())
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

func Test_handler_UpdateDeploymentsInBatchQuery(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	tests := []struct {
		name    string
		args    testArgs
		want    bool
		wantErr bool
		setup   func(*testArgs)
		cleanup func(*testArgs)
	}{
		{
			name: "trigger updates of deployments in cluster based on the query",
			args: testArgs{
				kubeConfig:       kubeConfig,
				totalDeployments: 2,
				deploymentIDs:    []string{"instance-id-1", "instance-id-2"},
				serviceIDs:       []string{"service-id-1", "service-id-2"},
				planIDs:          []string{"plan-id-1", "plan-id-2"},
				queryArgs: &queryArgs{
					serviceQuery:         "service-id-1",
					exepectedDeployments: 1,
				},
			},
			want:    true,
			wantErr: false,
			setup: func(args *testArgs) {
				g.Expect(deployTestResources(c, args)).NotTo(gomega.HaveOccurred())
			},
			cleanup: func(args *testArgs) {
				g.Expect(cleanupTestResources(c, args)).NotTo(gomega.HaveOccurred())
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
			router.HandleFunc("/admin/deployments/", h.UpdateDeploymentsInBatch).Methods("PATCH")
			req, err := http.NewRequest("PATCH", "/admin/deployments/", nil)
			if err != nil {
				t.Fatal(err)
			}
			q := req.URL.Query()
			if tt.args.queryArgs.serviceQuery != "" {
				q.Add("service", tt.args.queryArgs.serviceQuery)
			}
			if tt.args.queryArgs.planQuery != "" {
				q.Add("plan", tt.args.queryArgs.planQuery)
			}
			req.URL.RawQuery = q.Encode()
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)
			time.Sleep(time.Duration(tt.args.totalDeployments*constants.DelayBetweenBatchUpdates) * time.Second)
			if tt.want {
				if status := rr.Code; status != http.StatusOK {
					t.Errorf("handler returned wrong status code: got %v want %v",
						status, http.StatusOK)
				}
				updateCount := 0
				for i := 0; i < tt.args.totalDeployments; i++ {
					instance := &osbv1alpha1.SFServiceInstance{}
					key := types.NamespacedName{
						Name:      tt.args.deploymentIDs[i],
						Namespace: "sf-" + tt.args.deploymentIDs[i],
					}
					g.Expect(c.Get(context.TODO(), key, instance)).NotTo(gomega.HaveOccurred())
					if instance.GetState() == "update" {
						updateCount++
					}
				}
				if updateCount != tt.args.queryArgs.exepectedDeployments {
					t.Errorf("Expected updateCount %v got %v ", tt.args.queryArgs.exepectedDeployments, updateCount)
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

func deployTestResources(c client.Client, args *testArgs) error {
	for i := 0; i < args.totalDeployments; i++ {
		instance := &osbv1alpha1.SFServiceInstance{
			ObjectMeta: metav1.ObjectMeta{
				Name:      args.deploymentIDs[i],
				Namespace: "sf-" + args.deploymentIDs[i],
				Labels: map[string]string{
					"state":      "succeeded",
					"service_id": args.serviceIDs[i],
					"plan_id":    args.planIDs[i],
				},
			},
			Spec: osbv1alpha1.SFServiceInstanceSpec{
				ServiceID:        args.serviceIDs[i],
				PlanID:           args.planIDs[i],
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
		err := c.Create(context.TODO(), instance)
		if err != nil {
			return err
		}
	}
	return nil
}

func cleanupTestResources(c client.Client, args *testArgs) error {
	for i := 0; i < args.totalDeployments; i++ {
		instance := &osbv1alpha1.SFServiceInstance{}
		key := types.NamespacedName{
			Name:      args.deploymentIDs[i],
			Namespace: "sf-" + args.deploymentIDs[i],
		}
		err := c.Get(context.TODO(), key, instance)
		if err != nil {
			return err
		}
		err = c.Delete(context.TODO(), instance)
		if err != nil {
			return err
		}
	}
	return nil
}
