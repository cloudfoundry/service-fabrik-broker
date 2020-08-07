package middlewares

import (
	"crypto/subtle"
	"net/http"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/config"
	ctrl "sigs.k8s.io/controller-runtime"
)

var log = ctrl.Log.WithName("handler")

func getAdminConfig() *config.InteroperatorAdminConfig {
	kubeConfig, err := ctrl.GetConfig()
	if err != nil {
		log.Error(err, "Error getting kubeconfig in middleware")
	}
	cfgManager, err := config.New(kubeConfig)
	if err != nil {
		log.Error(err, "Error getting adminConfig in middleware")
	}
	adminConfig := cfgManager.GetConfig()
	return adminConfig
}

// BasicAuthHandler is the middleware to perform Basic Auth
func BasicAuthHandler(next http.Handler) http.Handler {
	adminConfig := getAdminConfig()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		username := adminConfig.Username
		password := adminConfig.Password
		if !ok || subtle.ConstantTimeCompare([]byte(user), []byte(username)) != 1 || subtle.ConstantTimeCompare([]byte(pass), []byte(password)) != 1 {
			http.Error(w, "Forbidden", http.StatusForbidden)
		} else {
			next.ServeHTTP(w, r)
		}
	})
}
