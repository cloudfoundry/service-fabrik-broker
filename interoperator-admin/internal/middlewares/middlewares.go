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
	adminConfig *config.InteroperatorAdminConfig
}

// NewMiddlewares returns Middlewares struct using given configManager
func NewMiddlewares(adminConfig *config.InteroperatorAdminConfig) (*Middlewares, error) {
	if adminConfig == nil {
		return nil, errors.New("config manager was not provided")
	}
	return &Middlewares{
		adminConfig: adminConfig,
	}, nil
}

// BasicAuthHandler is the middleware to perform Basic Auth
func (m *Middlewares) BasicAuthHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		username := m.adminConfig.Username
		password := m.adminConfig.Password
		if !ok || subtle.ConstantTimeCompare([]byte(user), []byte(username)) != 1 || subtle.ConstantTimeCompare([]byte(pass), []byte(password)) != 1 {
			http.Error(w, "Unauthorized: Basic Auth credentials invalid", http.StatusUnauthorized)
		} else {
			next.ServeHTTP(w, r)
		}
	})
}
