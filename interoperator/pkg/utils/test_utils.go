package utils

import (
	"time"

	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

// DrainAllRequests reads from the requests channel until no new request comes
// for remainingTime duration. Returns the number of requests drained
func DrainAllRequests(requests <-chan reconcile.Request, remainingTime time.Duration) int {
	timeout := time.After(remainingTime)
	// Drain all requests
	select {
	case <-requests:
		return 1 + drainAllRequests(requests, timeout)
	case <-timeout:
		return 0
	}
}

func drainAllRequests(requests <-chan reconcile.Request, timeout <-chan time.Time) int {
	// Drain all requests
	select {
	case <-requests:
		return 1 + drainAllRequests(requests, timeout)
	case <-timeout:
		return 0
	}
}
