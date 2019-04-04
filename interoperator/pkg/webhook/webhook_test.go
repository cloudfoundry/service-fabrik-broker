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

package webhook

import (
	"fmt"
	stdlog "log"
	"testing"

	"sigs.k8s.io/controller-runtime/pkg/envtest"
	"sigs.k8s.io/controller-runtime/pkg/manager"
)

func TestAddToManager(t *testing.T) {
	testEnv := &envtest.Environment{}
	cfg, err := testEnv.Start()
	if err != nil {
		stdlog.Fatal(err)
	}

	mgr, err := manager.New(cfg, manager.Options{})
	if err != nil {
		stdlog.Fatal(err)
	}
	defer testEnv.Stop()

	type args struct {
		m manager.Manager
	}
	tests := []struct {
		name    string
		setup   func()
		args    args
		wantErr bool
	}{
		{
			name: "add webhooks",
			setup: func() {
				AddToManagerFuncs = append(AddToManagerFuncs, func(mgr manager.Manager) error { return nil })
			},
			args: args{
				m: mgr,
			},
			wantErr: false,
		},
		{
			name: "add webhooks fails",
			setup: func() {
				AddToManagerFuncs = append(AddToManagerFuncs, func(mgr manager.Manager) error { return fmt.Errorf("failed") })
			},
			args: args{
				m: mgr,
			},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		tt.setup()
		t.Run(tt.name, func(t *testing.T) {
			if err := AddToManager(tt.args.m); (err != nil) != tt.wantErr {
				t.Errorf("AddToManager() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
