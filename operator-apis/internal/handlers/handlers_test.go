package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis/internal/config"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis/internal/constants"
	"github.com/gorilla/mux"
	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/onsi/gomega"
)

type queryArgs struct {
	serviceQuery         string
	planQuery            string
	pageSizeQuery        int
	exepectedDeployments int
}
type testArgs struct {
	appConfig        *config.OperatorApisConfig
	totalDeployments int
	deploymentIDs    []string
	serviceIDs       []string
	planIDs          []string
	queryArgs        *queryArgs
}

func TestNewOperatorApisHandler(t *testing.T) {
	tests := []struct {
		name    string
		args    testArgs
		want    bool
		wantErr bool
	}{
		{
			name:    "fail if config is not passed",
			args:    testArgs{},
			want:    false,
			wantErr: true,
		},
		{
			name: "return OperatorApisHandler",
			args: testArgs{
				appConfig: &config.OperatorApisConfig{
					Kubeconfig: kubeConfig,
				},
			},
			want:    true,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NewOperatorApisHandler(tt.args.appConfig)
			if (err != nil) != tt.wantErr {
				t.Errorf("NewOperatorApisHandler() error got= %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.want == true && got.appConfig != tt.args.appConfig {
				t.Errorf("NewOperatorApisHandler() got %v, want %v", got, tt.want)
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
				appConfig: &config.OperatorApisConfig{
					Kubeconfig: kubeConfig,
				},
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
				appConfig: &config.OperatorApisConfig{
					Kubeconfig: kubeConfig,
				},
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
			h, _ := NewOperatorApisHandler(tt.args.appConfig)
			router := mux.NewRouter()
			router.HandleFunc("/operator/deployments/{deploymentID}", h.GetDeployment).Methods("GET")
			req, err := http.NewRequest("GET", "/operator/deployments/"+tt.args.deploymentIDs[0], nil)
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
				appConfig: &config.OperatorApisConfig{
					Kubeconfig: kubeConfig,
				},
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
			name: "returns error when proper kubeconfig is not provided",
			args: testArgs{
				appConfig: &config.OperatorApisConfig{
					Kubeconfig: &rest.Config{},
				},
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
			h, _ := NewOperatorApisHandler(tt.args.appConfig)
			router := mux.NewRouter()
			router.HandleFunc("/operator/deployments/", h.GetDeploymentsSummary).Methods("GET")
			req, err := http.NewRequest("GET", "/operator/deployments/", nil)
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
				if deploymentsSummaryResp.TotalDeploymentsOnPage != tt.args.totalDeployments {
					t.Errorf("handler returned wrong deployment summary response. Total Deployments: got %v want %v",
						deploymentsSummaryResp.TotalDeploymentsOnPage, tt.args.totalDeployments)
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
				appConfig: &config.OperatorApisConfig{
					Kubeconfig: kubeConfig,
				},
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
				appConfig: &config.OperatorApisConfig{
					Kubeconfig: kubeConfig,
				},
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
			h, _ := NewOperatorApisHandler(tt.args.appConfig)
			router := mux.NewRouter()
			router.HandleFunc("/operator/deployments/", h.GetDeploymentsSummary).Methods("GET")
			req, err := http.NewRequest("GET", "/operator/deployments/", nil)
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
				if deploymentsSummaryResp.TotalDeploymentsOnPage != tt.args.queryArgs.exepectedDeployments {
					t.Errorf("handler returned wrong deployment summary response. Total Deployments: got %v want %v",
						deploymentsSummaryResp.TotalDeploymentsOnPage, tt.args.queryArgs.exepectedDeployments)
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

func Test_handler_GetDeploymentsSummaryPagination(t *testing.T) {
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
			name: "returns summary based on pagesize parameter",
			args: testArgs{
				appConfig: &config.OperatorApisConfig{
					Kubeconfig: kubeConfig,
				},
				totalDeployments: 4,
				deploymentIDs:    []string{"instance-id-1", "instance-id-2", "instance-id-3", "instance-id-4"},
				serviceIDs:       []string{"service-id-1", "service-id-2", "service-id-1", "service-id-1"},
				planIDs:          []string{"plan-id-1", "plan-id-2", "plan-id-1", "plan-id-1"},
				queryArgs: &queryArgs{
					serviceQuery:         "service-id-1",
					exepectedDeployments: 3,
					pageSizeQuery:        2,
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
			h, _ := NewOperatorApisHandler(tt.args.appConfig)
			router := mux.NewRouter()
			router.HandleFunc("/operator/deployments", h.GetDeploymentsSummary).Methods("GET")
			deploymentsFetched := 0
			reqURL := "/operator/deployments?service=" + tt.args.queryArgs.serviceQuery + "&pageSize=" + strconv.Itoa(tt.args.queryArgs.pageSizeQuery)
			for {
				req, err := http.NewRequest("GET", reqURL, nil)
				if err != nil {
					t.Fatal(err)
				}
				rr := httptest.NewRecorder()
				router.ServeHTTP(rr, req)
				if status := rr.Code; status != http.StatusOK {
					t.Errorf("handler returned wrong status code: got %v want %v",
						status, http.StatusOK)
				}
				deploymentsSummaryResp := deploymentsSummaryResponse{}
				json.Unmarshal(rr.Body.Bytes(), &deploymentsSummaryResp)
				deploymentsFetched += deploymentsSummaryResp.TotalDeploymentsOnPage
				if deploymentsSummaryResp.TotalDeployments != tt.args.queryArgs.exepectedDeployments {
					t.Errorf("handler returned wrong deployment summary response. Total Deployments: got %v want %v",
						deploymentsSummaryResp.TotalDeployments, tt.args.queryArgs.exepectedDeployments)
				}
				if deploymentsSummaryResp.NextPageURL != "" && deploymentsSummaryResp.TotalDeploymentsOnPage > tt.args.queryArgs.pageSizeQuery {
					t.Errorf("handler returned wrong deployment summary response. More than expected number of deployments were returned: got %v want %v",
						deploymentsSummaryResp.TotalDeploymentsOnPage, tt.args.queryArgs.pageSizeQuery)
				}
				if deploymentsSummaryResp.NextPageURL == "" && deploymentsFetched != tt.args.queryArgs.exepectedDeployments {
					t.Errorf("handler returned wrong deployment summary response. NextPageURL is empty before all deployments are fetched")
				}
				if deploymentsSummaryResp.NextPageURL == "" {
					break
				} else {
					reqURL = deploymentsSummaryResp.NextPageURL
					time.Sleep(time.Duration(time.Second))
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
				appConfig: &config.OperatorApisConfig{
					Kubeconfig: kubeConfig,
				},
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
			h, _ := NewOperatorApisHandler(tt.args.appConfig)
			router := mux.NewRouter()
			router.HandleFunc("/operator/deployments/{deploymentID}", h.UpdateDeployment).Methods("PATCH")
			req, err := http.NewRequest("PATCH", "/operator/deployments/"+tt.args.deploymentIDs[0], nil)
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
				appConfig: &config.OperatorApisConfig{
					Kubeconfig: kubeConfig,
				},
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
			h, _ := NewOperatorApisHandler(tt.args.appConfig)
			router := mux.NewRouter()
			router.HandleFunc("/operator/deployments/", h.UpdateDeploymentsInBatch).Methods("PATCH")
			req, err := http.NewRequest("PATCH", "/operator/deployments/", nil)
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
				appConfig: &config.OperatorApisConfig{
					Kubeconfig: kubeConfig,
				},
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
			h, _ := NewOperatorApisHandler(tt.args.appConfig)
			router := mux.NewRouter()
			router.HandleFunc("/operator/deployments/", h.UpdateDeploymentsInBatch).Methods("PATCH")
			req, err := http.NewRequest("PATCH", "/operator/deployments/", nil)
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
		ns := &corev1.Namespace{
			ObjectMeta: metav1.ObjectMeta{
				Name: "sf-" + args.deploymentIDs[i],
			},
		}
		err := c.Get(context.TODO(), types.NamespacedName{
			Name: "sf-" + args.deploymentIDs[i],
		}, ns)
		if err != nil && apiErrors.IsNotFound(err) {
			err := c.Create(context.TODO(), ns)
			if err != nil {
				return err
			}
		}
		err = c.Create(context.TODO(), instance)
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
