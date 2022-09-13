//go:build multiclusterdeploy
// +build multiclusterdeploy

/*
Copyright 2018 The Service Fabrik Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package constants

import (
	"os"
	"strconv"
)

// Constants used by interoperator which are used only in multiclusterdeploy build
const (
	LeaderElectionID = "interoperator-leader-election-helper-multiclusterdeploy"

	ReplicaCountEnvKey = "REPLICA_COUNT"
)

// Configs initialized at startup which are used only in multiclusterdeploy build
func init() {
	replicaCountStr, ok := os.LookupEnv(ReplicaCountEnvKey)
	if ok {
		if replicaCount, err := strconv.Atoi(replicaCountStr); err == nil {
			ReplicaCount = replicaCount
		}
	}
}
