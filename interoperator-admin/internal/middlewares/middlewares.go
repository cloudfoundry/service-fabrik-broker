package middlewares

import (
	"crypto/subtle"
	"errors"
	"net/http"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/config"
	ctrl "sigs.k8s.io/controller-runtime"
)

var log = ctrl.Log.WithName("handler")

// Middlewares represents a set of handlers to handle admin APIs
type Middlewares struct {
	configManager *config.ConfigManager
}

// NewMiddlewares returns Middlewares struct using given configManager
func NewMiddlewares(cfgManager *config.ConfigManager) (*Middlewares, error) {
	if cfgManager == nil {
		return nil, errors.New("kubeconfig was not provided")
	}
	return &Middlewares{
		configManager: cfgManager,
	}, nil
}

// BasicAuthHandler is the middleware to perform Basic Auth
func (m *Middlewares) BasicAuthHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		interoperatorAdminConfig := m.configManager.GetConfig(false)
		username := interoperatorAdminConfig.Username
		password := interoperatorAdminConfig.Password
		if !ok || subtle.ConstantTimeCompare([]byte(user), []byte(username)) != 1 || subtle.ConstantTimeCompare([]byte(pass), []byte(password)) != 1 {
			http.Error(w, "Forbidden", http.StatusForbidden)
		} else {
			next.ServeHTTP(w, r)
		}
	})
}
