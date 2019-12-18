/*
Copyright 2019 The Service Fabrik Authors.

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

package helm

import (
	"reflect"
	"testing"
)

func Test_helmOutput_FileContent(t *testing.T) {
	out := &helmOutput{
		Name:  "chart",
		Files: make(map[string]string),
	}
	out.Files["file"] = "fileContent"
	type args struct {
		filename string
	}
	tests := []struct {
		name    string
		c       *helmOutput
		args    args
		want    string
		wantErr bool
	}{
		{
			name: "should return fileContent",
			c:    out,
			args: args{
				filename: "file",
			},
			want:    "fileContent",
			wantErr: false,
		},
		{
			name: "should fail if file is not present",
			c:    out,
			args: args{
				filename: "file2",
			},
			want:    "",
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.c.FileContent(tt.args.filename)
			if (err != nil) != tt.wantErr {
				t.Errorf("helmOutput.FileContent() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("helmOutput.FileContent() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_helmOutput_ListFiles(t *testing.T) {
	out := &helmOutput{
		Name:  "chart",
		Files: make(map[string]string),
	}
	out.Files["file"] = "fileContent"
	out.Files["file2"] = "file2Content"
	tests := []struct {
		name    string
		c       *helmOutput
		want    []string
		wantErr bool
	}{
		{
			name:    "should return list of files",
			c:       out,
			want:    []string{"file", "file2"},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.c.ListFiles()
			if (err != nil) != tt.wantErr {
				t.Errorf("helmOutput.ListFiles() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("helmOutput.ListFiles() = %v, want %v", got, tt.want)
			}
		})
	}
}
