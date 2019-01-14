package properties

import (
	"reflect"
	"testing"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
)

func TestParseSources(t *testing.T) {
	type args struct {
		sourcesString string
	}
	tests := []struct {
		name    string
		args    args
		want    map[string]osbv1alpha1.Source
		wantErr bool
	}{
		{
			name: "fail parse",
			args: args{
				sourcesString: "foo",
			},
			want:    nil,
			wantErr: true,
		},
		{
			name: "parse string",
			args: args{
				sourcesString: `foo:
  apiVersion: "apiVersion"
  kind: "kind"
  name: "name"
  namespace: "namespace"`,
			},
			want: map[string]osbv1alpha1.Source{
				"foo": osbv1alpha1.Source{
					APIVersion: "apiVersion",
					Kind:       "kind",
					Name:       "name",
					Namespace:  "namespace",
				},
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseSources(tt.args.sourcesString)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseSources() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("ParseSources() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestParseProperties(t *testing.T) {
	type args struct {
		propertiesString string
	}
	status := GenericStatus{
		State: "state",
	}
	tests := []struct {
		name    string
		args    args
		want    *Properties
		wantErr bool
	}{
		{
			name: "fail parse",
			args: args{
				propertiesString: "foo",
			},
			want:    nil,
			wantErr: true,
		},
		{
			name: "parse string",
			args: args{
				propertiesString: `provision:
  state: state
bind:
  state: state
unbind:
  state: state
deprovision:
  state: state`,
			},
			want: &Properties{
				Provision: InstanceStatus{
					State: "state",
				},
				Bind:        status,
				Unbind:      status,
				Deprovision: status,
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseProperties(tt.args.propertiesString)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseProperties() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("ParseProperties() = %v, want %v", got, tt.want)
			}
		})
	}
}
