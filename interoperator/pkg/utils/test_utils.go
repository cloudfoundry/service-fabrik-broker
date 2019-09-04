package utils

import (
	"time"

	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

// DrainAllRequests reads from the requests channel until no new request comes
// for remainingTime duration. Returns the number of requests drained
func DrainAllRequests(requests <-chan reconcile.Request, remainingTime time.Duration) int {
	// Drain all requests
	select {
	case <-requests:
		return 1 + DrainAllRequests(requests, remainingTime)
	case <-time.After(remainingTime):
		return 0
	}
}
