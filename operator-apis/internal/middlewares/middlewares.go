package middlewares

import (
	"crypto/subtle"
	"errors"
	"net/http"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis/internal/config"
)

// Middlewares represents a set of functions to provide supporting middlewares for operator apis
type Middlewares struct {
	appConfig *config.OperatorApisConfig
}

// NewMiddlewares returns Middlewares struct using given OperatorApisConfig instance
func NewMiddlewares(operatorApisConfig *config.OperatorApisConfig) (*Middlewares, error) {
	if operatorApisConfig == nil {
		return nil, errors.New("config manager was not provided")
	}
	return &Middlewares{
		appConfig: operatorApisConfig,
	}, nil
}

// BasicAuthHandler is the middleware to perform Basic Auth
func (m *Middlewares) BasicAuthHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		username := m.appConfig.Username
		password := m.appConfig.Password
		if !ok || subtle.ConstantTimeCompare([]byte(user), []byte(username)) != 1 || subtle.ConstantTimeCompare([]byte(pass), []byte(password)) != 1 {
			http.Error(w, "Unauthorized: Basic Auth credentials invalid", http.StatusUnauthorized)
		} else {
			next.ServeHTTP(w, r)
		}
	})
}
